import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  DEAL_PLACE_LABELS,
  DEAL_PLACES,
  LISTING_DESCRIPTION_MAX,
  OPERATION_LABELS,
  SURCHARGE_DIRECTION_LABELS,
  TRANSFER_MODE_LABELS,
  TRANSFER_MODES,
  buildAttributesSchema,
  definitionsForCategory,
  fieldErrors,
  formatPrice,
  listingInputSchema,
  parsePrice,
  type AttributeValue,
  type CatalogItemOptionDto,
  type DealPlace,
  type GameProfileDto,
  type ListingTypeDto,
  type MyListingDto,
  type Operation,
  type SectionCode,
  type SurchargeDirection,
  type TransferMode,
} from "@twm/shared";
import { AttributeField } from "../../components/AttributeField";
import { Media } from "../../components/listing";
import { Alert, Button, Card, Field } from "../../components/ui";
import { ApiError, api, mediaSrc } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useAttributes, useCatalog } from "../../lib/catalog";

type Values = Record<string, AttributeValue>;

type ImageEntry =
  | { key: string; kind: "server"; id: string; url: string }
  | { key: string; kind: "local"; file: File; url: string };

const SECTION_TABS: Array<[SectionCode, string]> = [
  ["items", "Предметы"],
  ["cars", "Авторынок"],
  ["notary", "Нотариус"],
];

const MAX_FILE_MB = 10;
let keySeq = 0;
const nextKey = () => `img-${++keySeq}`;

/** Подача и редактирование объявления. */
export function ListingFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: catalog } = useCatalog();

  const [loaded, setLoaded] = useState<MyListingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<GameProfileDto[] | null>(null);

  const [section, setSection] = useState<SectionCode>("items");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation>("sell");
  const [profileId, setProfileId] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [priceText, setPriceText] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [transferMode, setTransferMode] = useState<TransferMode>("none");
  const [dealPlaces, setDealPlaces] = useState<DealPlace[]>(["car_market"]);
  const [attributes, setAttributes] = useState<Values>({});
  const [wantTypeId, setWantTypeId] = useState<number | null>(null);
  const [wantAttributes, setWantAttributes] = useState<Values>({});
  const [wantDescription, setWantDescription] = useState("");
  const [surchargeText, setSurchargeText] = useState("");
  const [surchargeDirection, setSurchargeDirection] = useState<SurchargeDirection | null>(null);
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [mainKey, setMainKey] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "draft" | "publish">(null);

  // ── Загрузка данных ───────────────────────────────────────────────────────

  useEffect(() => {
    api
      .gameProfiles()
      .then((r) => {
        setProfiles(r.items);
        setProfileId((current) => current || r.items[0]?.id || "");
      })
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .myListing(id)
      .then((l) => {
        setLoaded(l);
        setSection(l.sectionCode);
        setTypeId(l.listingType.id);
        setOperation(l.operation);
        setProfileId(l.gameProfileId);
        setCategoryId(l.categoryId);
        setItemId(l.catalogItem?.id ?? null);
        setTitle(l.title);
        setPriceText(l.price !== null ? formatPrice(l.price).replace(/\s?₽$/, "") : "");
        setQuantity(String(l.quantity));
        setTransferMode(l.transferMode);
        setDealPlaces(l.dealPlaces);
        setAttributes(l.rawAttributes);
        setWantTypeId(l.wantListingTypeId);
        setWantAttributes(l.rawWantAttributes);
        setWantDescription(l.want?.description ?? "");
        setSurchargeText(l.want?.surcharge ? formatPrice(l.want.surcharge).replace(/\s?₽$/, "") : "");
        setSurchargeDirection(l.want?.surchargeDirection ?? null);
        setDescription(l.description);
        const entries: ImageEntry[] = l.images.map((img) => ({ key: nextKey(), kind: "server", id: img.id, url: img.thumbUrl }));
        setImages(entries);
        setMainKey(entries[l.images.findIndex((img) => img.isMain)]?.key ?? entries[0]?.key ?? null);
      })
      .catch((e: unknown) => setLoadError(e instanceof ApiError ? e.message : "Не удалось загрузить объявление"));
  }, [id]);

  const sectionTypes = useMemo(
    () => catalog?.listingTypes.filter((t) => t.sectionCode === section) ?? [],
    [catalog, section],
  );
  const type: ListingTypeDto | null = sectionTypes.find((t) => t.id === typeId) ?? null;

  // У предметов и транспорта по одному типу — выбираем его сразу.
  useEffect(() => {
    if (id || !catalog) return;
    if (sectionTypes.length === 1) setTypeId(sectionTypes[0]!.id);
    else if (!sectionTypes.some((t) => t.id === typeId)) setTypeId(null);
  }, [catalog, sectionTypes, typeId, id]);

  useEffect(() => {
    if (type && !type.operations.includes(operation)) setOperation(type.operations[0] ?? "sell");
  }, [type, operation]);

  const definitions = useAttributes(typeId);
  const categories = catalog?.categories.filter((c) => c.sectionCode === section && c.parentId === null) ?? [];

  // Часть полей относится только к некоторым категориям (улучшение — у аксессуаров
  // и одежды, целостность — у одежды). Путь: категория предмета и её родитель.
  const categoryPath = useMemo(() => {
    if (categoryId === null) return null;
    const parent = catalog?.categories.find((c) => c.id === categoryId)?.parentId ?? null;
    return parent === null ? [categoryId] : [categoryId, parent];
  }, [catalog, categoryId]);
  const offerApplicable = useMemo(() => definitionsForCategory(definitions, categoryPath), [definitions, categoryPath]);
  const wantApplicable = useMemo(() => definitionsForCategory(definitions, null), [definitions]);
  const offerDefs = offerApplicable.filter((d) => d.appliesTo !== "want");
  const wantDefs = wantApplicable.filter((d) => d.appliesTo !== "offer");
  const usesCatalog = section !== "notary";

  // ── Изображения ───────────────────────────────────────────────────────────

  const maxImages = type?.maxImages ?? 10;

  const addFiles = useCallback(
    (files: File[]) => {
      setFormError(null);
      const accepted: ImageEntry[] = [];
      for (const file of files) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
          setFormError(`«${file.name || "файл"}» — не изображение. Подходят PNG, JPG и WebP.`);
          continue;
        }
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          setFormError(`«${file.name}» больше ${MAX_FILE_MB} МБ.`);
          continue;
        }
        accepted.push({ key: nextKey(), kind: "local", file, url: URL.createObjectURL(file) });
      }
      setImages((list) => {
        const room = Math.max(0, maxImages - list.length);
        if (accepted.length > room) setFormError(`Можно загрузить не больше ${maxImages} изображений.`);
        const next = [...list, ...accepted.slice(0, room)];
        setMainKey((m) => m ?? next[0]?.key ?? null);
        return next;
      });
    },
    [maxImages],
  );

  // Скриншот из буфера обмена: Ctrl+V в любом месте формы.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files.map((f, i) => (f.name ? f : new File([f], `screenshot-${Date.now()}-${i}.png`, { type: f.type }))));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  useEffect(
    () => () => {
      for (const img of images) if (img.kind === "local") URL.revokeObjectURL(img.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const removeImage = async (entry: ImageEntry) => {
    if (entry.kind === "server" && loaded) {
      try {
        await api.deleteListingImage(loaded.id, entry.id);
      } catch (e) {
        setFormError(e instanceof ApiError ? e.message : "Не удалось удалить изображение");
        return;
      }
    }
    if (entry.kind === "local") URL.revokeObjectURL(entry.url);
    setImages((list) => {
      const next = list.filter((i) => i.key !== entry.key);
      if (mainKey === entry.key) setMainKey(next[0]?.key ?? null);
      return next;
    });
  };

  // ── Отправка ──────────────────────────────────────────────────────────────

  const submit = async (publish: boolean) => {
    setErrors({});
    setFormError(null);
    if (!type) {
      setErrors({ listingTypeId: "Выберите тип имущества" });
      return;
    }

    const price = priceText.trim() ? parsePrice(priceText) : null;
    const surcharge = surchargeText.trim() ? parsePrice(surchargeText) : null;
    const local: Record<string, string> = {};
    if (priceText.trim() && price === null) local.price = "Не понимаю сумму. Пример: 500к, 2.5кк, 18 000 000";
    if (surchargeText.trim() && surcharge === null) local.surcharge = "Не понимаю сумму";

    const body = {
      gameProfileId: profileId,
      listingTypeId: type.id,
      operation,
      catalogItemId: usesCatalog ? itemId : null,
      // У предметов и транспорта название берётся из справочника.
      title: usesCatalog ? "" : title.trim(),
      description: description.trim(),
      price,
      quantity: Number(quantity) || 1,
      transferMode,
      dealPlaces: section === "cars" ? dealPlaces : [],
      attributes,
      wantListingTypeId: operation === "exchange" ? wantTypeId : null,
      wantAttributes: operation === "exchange" ? wantAttributes : {},
      wantDescription: operation === "exchange" ? wantDescription.trim() : "",
      surcharge: operation === "exchange" ? surcharge : null,
      surchargeDirection: operation === "exchange" && surcharge !== null ? surchargeDirection : null,
    };

    const parsed = listingInputSchema.safeParse(body);
    const all: Record<string, string> = { ...local, ...(parsed.success ? {} : fieldErrors(parsed.error)) };
    const offer = buildAttributesSchema(offerApplicable, "offer").safeParse(attributes);
    if (!offer.success) for (const [k, m] of Object.entries(fieldErrors(offer.error))) all[`attributes.${k}`] = m;
    if (operation === "exchange") {
      const want = buildAttributesSchema(wantApplicable, "want").safeParse(wantAttributes);
      if (!want.success) for (const [k, m] of Object.entries(fieldErrors(want.error))) all[`wantAttributes.${k}`] = m;
    }
    if (usesCatalog && !itemId) {
      all.catalogItemId = section === "cars" ? "Выберите модель из справочника" : "Выберите предмет из справочника";
    }
    if (!usesCatalog && title.trim().length < 3) all.title = "Название — от 3 символов";
    if (Object.keys(all).length > 0) {
      setErrors(all);
      setFormError("Проверьте отмеченные поля");
      return;
    }

    setBusy(publish ? "publish" : "draft");
    try {
      let saved = loaded ? await api.updateListing(loaded.id, body) : await api.createListing(body);
      setLoaded(saved);

      // Загружаем новые изображения по порядку и запоминаем их id на сервере.
      const keyToId = new Map<string, string>();
      let known = new Set(saved.images.map((i) => i.id));
      for (const entry of images) {
        if (entry.kind === "server") {
          keyToId.set(entry.key, entry.id);
          continue;
        }
        const result = await api.uploadListingImage(saved.id, entry.file, entry.file.name || "image.png");
        const added = result.images.find((i) => !known.has(i.id));
        if (added) keyToId.set(entry.key, added.id);
        known = new Set(result.images.map((i) => i.id));
      }
      const order = images.map((i) => keyToId.get(i.key)).filter((x): x is string => Boolean(x));
      if (order.length > 0) {
        await api.orderListingImages(saved.id, order, (mainKey && keyToId.get(mainKey)) || order[0] || null);
      }
      setImages(images.map((i) => (i.kind === "local" && keyToId.has(i.key) ? { key: i.key, kind: "server", id: keyToId.get(i.key)!, url: i.url } : i)));

      if (publish && ["draft", "withdrawn", "archived"].includes(saved.status)) {
        saved = await api.listingAction(saved.id, "publish");
      }
      navigate(publish || saved.status === "active" ? `/listing/${saved.id}` : "/my/listings", { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        setFormError(e.message);
      } else {
        setFormError("Не удалось сохранить объявление");
      }
    } finally {
      setBusy(null);
    }
  };

  // ── Разметка ──────────────────────────────────────────────────────────────

  if (loadError) return <Alert>{loadError}</Alert>;
  if (id && !loaded) return <p className="text-muted">Загружаю…</p>;
  if (profiles && profiles.length === 0) {
    return (
      <Card className="flex max-w-[640px] flex-col items-start gap-3">
        <h1 className="m-0 font-display text-2xl font-bold">Сначала добавьте игровой профиль</h1>
        <p className="m-0 text-muted">Объявление публикуется от имени игрового ника на конкретном сервере.</p>
        <Link to="/account" className="font-bold text-accent">
          Перейти в личный кабинет →
        </Link>
      </Card>
    );
  }

  const isEdit = Boolean(loaded);
  const parsedPrice = priceText.trim() ? parsePrice(priceText) : null;
  const canPublish = !loaded || ["draft", "withdrawn", "archived"].includes(loaded.status);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 font-display text-[28px] font-bold">{isEdit ? "Редактирование объявления" : "Новое объявление"}</h1>
      {user && !user.emailVerified && (
        <Alert tone="warning">
          Сохранить черновик можно сейчас, а опубликовать — после подтверждения email.{" "}
          <Link to="/verify-email" className="font-bold text-accent">
            Подтвердить →
          </Link>
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <form className="flex min-w-0 flex-[999_1_560px] flex-col gap-5" noValidate onSubmit={(e) => e.preventDefault()}>
          <Step n={1} title="Что публикуете">
            <div role="group" aria-label="Раздел" className="flex flex-wrap gap-2">
              {SECTION_TABS.map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  disabled={isEdit}
                  aria-pressed={section === code}
                  onClick={() => {
                    setSection(code);
                    setItemId(null);
                    setCategoryId(null);
                    setAttributes({});
                  }}
                  className={`h-11 rounded-xl border px-4 font-bold disabled:cursor-not-allowed ${
                    section === code ? "border-2 border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-faint"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {sectionTypes.length > 1 && (
              <SelectField
                label="Тип имущества"
                value={typeId ?? ""}
                disabled={isEdit}
                error={errors.listingTypeId}
                onChange={(v) => {
                  setTypeId(v ? Number(v) : null);
                  setAttributes({});
                }}
                options={[["", "Выберите…"], ...sectionTypes.map((t): [string, string] => [String(t.id), t.name])]}
              />
            )}

            {type && (
              <div role="group" aria-label="Операция" className="flex self-start rounded-xl border border-line bg-ground p-1">
                {type.operations.map((op) => (
                  <button
                    key={op}
                    type="button"
                    aria-pressed={operation === op}
                    onClick={() => setOperation(op)}
                    className={`h-9 rounded-[9px] px-4 text-sm font-bold ${operation === op ? "bg-line text-ink" : "text-muted"}`}
                  >
                    {OPERATION_LABELS[op]}
                  </button>
                ))}
              </div>
            )}

            <SelectField
              label="От имени игрового профиля"
              value={profileId}
              error={errors.gameProfileId}
              hint="Сервер объявления берётся из профиля"
              onChange={setProfileId}
              options={(profiles ?? []).map((p): [string, string] => [p.id, `${p.nickname} · ${p.server.name}`])}
            />

            {usesCatalog ? (
              <ItemPicker
                kind={section === "cars" ? "vehicle" : "item"}
                categories={categories}
                categoryId={categoryId}
                itemId={itemId}
                error={errors.catalogItemId}
                onCategory={(c) => {
                  setCategoryId(c);
                  setItemId(null);
                }}
                onItem={setItemId}
              />
            ) : (
              <Field label="Название" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} error={errors.title} hint="Например: «Дом у моря» или «SIM 777-77-77»" />
            )}
          </Step>

          <Step n={2} title="Цена и условия">
            <div className="flex flex-wrap gap-3">
              <Field
                label={operation === "buy" ? "Готов заплатить до, ₽" : operation === "exchange" ? "Цена, ₽ (необязательно)" : "Цена, ₽"}
                className="min-w-[220px] flex-1"
                mono
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                error={errors.price}
                hint={parsedPrice !== null ? `= ${formatPrice(parsedPrice)}` : "Можно сокращённо: 500к, 18.2кк"}
              />
              {section === "items" && (
                <Field label="Количество" className="w-32" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} error={errors.quantity} />
              )}
            </div>

            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1.5 text-sm text-muted">Перевод на другой сервер</legend>
              {TRANSFER_MODES.map((mode) => (
                <label key={mode} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px] text-ink-2">
                  <input type="radio" name="transfer" checked={transferMode === mode} onChange={() => setTransferMode(mode)} className="accent-accent" />
                  {TRANSFER_MODE_LABELS[mode]}
                </label>
              ))}
            </fieldset>

            {section === "cars" && (
              <fieldset className="m-0 flex flex-wrap gap-x-5 border-0 p-0">
                <legend className="mb-1.5 text-sm text-muted">Способ сделки</legend>
                {DEAL_PLACES.map((place) => (
                  <label key={place} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[15px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={dealPlaces.includes(place)}
                      onChange={(e) => setDealPlaces((list) => (e.target.checked ? [...list, place] : list.filter((p) => p !== place)))}
                      className="size-[18px] accent-accent"
                    />
                    {DEAL_PLACE_LABELS[place]}
                  </label>
                ))}
              </fieldset>
            )}
          </Step>

          {offerDefs.length > 0 && (
            <Step n={3} title="Характеристики">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
                {offerDefs.map((def) => (
                  <AttributeField
                    key={def.id}
                    definition={def}
                    value={attributes[def.key]}
                    error={errors[`attributes.${def.key}`]}
                    onChange={(v) => setAttributes((a) => withValue(a, def.key, v))}
                  />
                ))}
              </div>
            </Step>
          )}

          {operation === "exchange" && (
            <Step n={offerDefs.length > 0 ? 4 : 3} title="Что хотите получить взамен">
              <SelectField
                label="Тип имущества (необязательно)"
                value={wantTypeId ?? ""}
                onChange={(v) => setWantTypeId(v ? Number(v) : null)}
                options={[
                  ["", "Любой"],
                  ...(catalog?.listingTypes.filter((t) => t.operations.includes("exchange")) ?? []).map((t): [string, string] => [String(t.id), t.name]),
                ]}
              />
              {wantDefs.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
                  {wantDefs.map((def) => (
                    <AttributeField
                      key={def.id}
                      definition={def}
                      value={wantAttributes[def.key]}
                      error={errors[`wantAttributes.${def.key}`]}
                      onChange={(v) => setWantAttributes((a) => withValue(a, def.key, v))}
                    />
                  ))}
                </div>
              )}
              <TextArea id="want-description" label="Пожелания и условия обмена" rows={3} max={1000} value={wantDescription} onChange={setWantDescription} error={errors.wantDescription} />
              <div className="flex flex-wrap items-start gap-3">
                <Field label="Доплата, ₽" className="min-w-[200px] flex-1" mono value={surchargeText} onChange={(e) => setSurchargeText(e.target.value)} error={errors.surcharge} />
                <SelectField
                  label="Кто доплачивает"
                  value={surchargeDirection ?? ""}
                  onChange={(v) => setSurchargeDirection((v || null) as SurchargeDirection | null)}
                  options={[["", "Без доплаты"], ...(["i_pay", "they_pay"] as const).map((d): [string, string] => [d, SURCHARGE_DIRECTION_LABELS[d]])]}
                />
              </div>
            </Step>
          )}

          <Step n={0} title="Изображения">
            <ImagesEditor images={images} mainKey={mainKey} max={maxImages} onAdd={addFiles} onRemove={(e) => void removeImage(e)} onMain={setMainKey} onReorder={setImages} />
          </Step>

          <Step n={0} title="Описание">
            <TextArea
              id="description"
              label="Описание"
              rows={5}
              max={LISTING_DESCRIPTION_MAX}
              value={description}
              onChange={setDescription}
              error={errors.description}
              placeholder="Состояние, особенности, когда удобно встретиться в игре"
            />
          </Step>

          {formError && <Alert>{formError}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            {canPublish && (
              <Button size="lg" loading={busy === "publish"} disabled={busy !== null} onClick={() => void submit(true)}>
                Опубликовать
              </Button>
            )}
            <Button
              variant={canPublish ? "secondary" : "primary"}
              size="lg"
              loading={busy === "draft"}
              disabled={busy !== null}
              onClick={() => void submit(false)}
            >
              {canPublish ? "Сохранить черновик" : "Сохранить изменения"}
            </Button>
            <span className="text-[13px] text-muted">Объявление публикуется на 14 дней, потом его можно продлить.</span>
          </div>
        </form>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 lg:max-w-[360px]">
          <Card className="flex flex-col gap-2.5 text-sm leading-relaxed text-ink-2">
            <h2 className="m-0 text-[15px] font-extrabold text-ink">Советы</h2>
            <p className="m-0">Скриншот можно вставить сразу из буфера: сделайте снимок экрана в игре и нажмите Ctrl+V на этой странице.</p>
            <p className="m-0">Объявления с фото и полными характеристиками находят чаще.</p>
            <p className="m-0">Не указывайте в описании реквизиты и контакты для оплаты вне игры — такие объявления удаляются.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function withValue(values: Values, key: string, value: AttributeValue | undefined): Values {
  const next = { ...values };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
      <h2 className="m-0 text-[17px] font-extrabold">
        {n > 0 && <span className="mr-2 font-mono text-accent">{String(n).padStart(2, "0")}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  error?: string | undefined;
  hint?: string;
  disabled?: boolean;
}) {
  const id = `select-${label}`;
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={`h-12 rounded-xl border bg-ground px-3 text-ink disabled:opacity-60 ${error ? "border-[#c45555]" : "border-line"}`}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
      {(error || hint) && <span className={`text-[13px] ${error ? "text-danger" : "text-faint"}`}>{error ?? hint}</span>}
    </div>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  rows,
  max,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  max: number;
  error?: string | undefined;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        maxLength={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`resize-y rounded-xl border bg-ground px-3.5 py-3 leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent ${error ? "border-[#c45555]" : "border-line"}`}
      />
      <span className={`self-end text-xs ${error ? "text-danger" : "text-faint"}`}>{error ?? `${value.length} / ${max}`}</span>
    </div>
  );
}

const PICKER_TEXT = {
  item: { category: "Категория", find: "Найти предмет", list: "Предметы", placeholder: "Название, другое имя или ID" },
  vehicle: { category: "Тип транспорта", find: "Найти модель", list: "Модели", placeholder: "Например: M5 F90 или бмв" },
} as const;

/**
 * Выбор из справочника: категория, поиск по названию и синонимам.
 * Предметы — сеткой с иконками, модели транспорта — компактным списком.
 */
function ItemPicker({
  kind,
  categories,
  categoryId,
  itemId,
  error,
  onCategory,
  onItem,
}: {
  kind: keyof typeof PICKER_TEXT;
  categories: Array<{ id: number; name: string }>;
  categoryId: number | null;
  itemId: number | null;
  error?: string | undefined;
  onCategory: (id: number | null) => void;
  onItem: (id: number | null) => void;
}) {
  const [items, setItems] = useState<CatalogItemOptionDto[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!categoryId) {
      setItems(null);
      return;
    }
    let cancelled = false;
    api
      .catalogItems({ categoryId })
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const q = query.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (i) => !q || i.name.toLowerCase().includes(q) || i.gameCode === q || i.aliases.some((a) => a.toLowerCase().includes(q)),
  );
  const selected = items?.find((i) => i.id === itemId);
  const text = PICKER_TEXT[kind];
  const compact = kind === "vehicle";

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={text.category}
        value={categoryId ?? ""}
        onChange={(v) => onCategory(v ? Number(v) : null)}
        options={[["", "Выберите…"], ...categories.map((c): [string, string] => [String(c.id), c.name])]}
      />
      {categoryId && (
        <>
          <Field label={text.find} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={text.placeholder} error={error} />
          {selected && (
            <span className="text-sm text-ink-2">
              Выбрано: <strong className="text-ink">{selected.name}</strong>
              {selected.gameCode && <span className="font-mono text-muted"> · ID {selected.gameCode}</span>}
            </span>
          )}
          <div
            role="listbox"
            aria-label={text.list}
            className={`grid max-h-[360px] gap-2 overflow-y-auto rounded-xl border border-line bg-ground p-2 ${
              compact ? "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(104px,1fr))]"
            }`}
          >
            {items === null && <span className="p-3 text-sm text-muted">Загружаю…</span>}
            {items !== null && visible.length === 0 && <span className="p-3 text-sm text-muted">Ничего не нашли</span>}
            {compact && visible.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === itemId}
                onClick={() => onItem(item.id)}
                className={`min-h-10 rounded-lg border-2 px-3 py-2 text-left text-sm font-bold leading-tight ${
                  item.id === itemId ? "border-accent bg-accent/10 text-ink" : "border-transparent bg-surface text-ink-2 hover:border-line"
                }`}
              >
                {item.name}
              </button>
            ))}
            {!compact && visible.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === itemId}
                onClick={() => onItem(item.id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-center text-xs font-bold leading-tight ${
                  item.id === itemId ? "border-accent bg-accent/10 text-ink" : "border-transparent bg-surface text-ink-2 hover:border-line"
                }`}
              >
                <Media media={item.icon} alt="" fit="contain" className="size-14" />
                <span className="line-clamp-2">{item.name}</span>
                {item.gameCode && <span className="font-mono text-[11px] font-normal text-faint">ID {item.gameCode}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {!categoryId && error && <span className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function ImagesEditor({
  images,
  mainKey,
  max,
  onAdd,
  onRemove,
  onMain,
  onReorder,
}: {
  images: ImageEntry[];
  mainKey: string | null;
  max: number;
  onAdd: (files: File[]) => void;
  onRemove: (entry: ImageEntry) => void;
  onMain: (key: string) => void;
  onReorder: (list: ImageEntry[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const moveTo = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    const list = [...images];
    const from = list.findIndex((i) => i.key === dragKey);
    const to = list.findIndex((i) => i.key === targetKey);
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
    onReorder(list);
  };

  const onDropFiles = (e: DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    if (e.dataTransfer.files.length > 0) onAdd(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] text-faint">
        PNG, JPG или WebP · до {MAX_FILE_MB} МБ · до {max} шт. · загружено {images.length}. Звёздочка — главное фото для каталога, порядок меняется
        перетаскиванием.
      </span>
      <div
        className={`grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 rounded-xl ${dropActive ? "outline-2 outline-dashed outline-accent" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDropFiles}
      >
        {images.map((entry, index) => {
          const isMain = entry.key === mainKey;
          return (
            <div
              key={entry.key}
              draggable
              onDragStart={() => setDragKey(entry.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => {
                if (dragKey) {
                  e.preventDefault();
                  moveTo(entry.key);
                }
              }}
              className={`relative aspect-[16/10] cursor-grab overflow-hidden rounded-xl border-2 bg-ground ${isMain ? "border-accent" : "border-line"} ${dragKey === entry.key ? "opacity-50" : ""}`}
            >
              <img src={mediaSrc(entry.url)} alt={`Изображение ${index + 1}`} className="size-full object-cover" />
              {isMain && <span className="absolute bottom-1.5 left-1.5 rounded-md bg-accent px-2 py-0.5 text-[11px] font-extrabold text-on-accent">Главное</span>}
              {entry.kind === "local" && <span className="absolute bottom-1.5 right-1.5 rounded-md bg-ground/80 px-2 py-0.5 text-[11px] text-ink-2">не сохранено</span>}
              <button
                type="button"
                aria-label={isMain ? "Главное изображение" : "Сделать главным"}
                aria-pressed={isMain}
                onClick={() => onMain(entry.key)}
                className="absolute left-1 top-1 flex size-9 items-center justify-center rounded-lg bg-ground/75 text-accent hover:bg-ground"
              >
                <span aria-hidden="true">{isMain ? "★" : "☆"}</span>
              </button>
              <button
                type="button"
                aria-label="Удалить изображение"
                onClick={() => onRemove(entry)}
                className="absolute right-1 top-1 flex size-9 items-center justify-center rounded-lg bg-ground/75 text-ink hover:bg-ground"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}
        {images.length < max && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex aspect-[16/10] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#3a404c] p-2 text-[13px] font-bold text-ink-2 hover:border-faint"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              +
            </span>
            Добавить
            <span className="font-normal text-muted">или Ctrl+V, перетащите файл</span>
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
