#define UNICODE
#define _UNICODE
#define DIRECTINPUT_VERSION 0x0800
#include <windows.h>
#include <d3d9.h>
#include <dinput.h>
#include <shellapi.h>
#include <algorithm>
#include <string>
#include <vector>

// Панель рисуется в кадре D3D9. Файлы и память игры не читаются.
namespace {
using EndScene = HRESULT (WINAPI*)(IDirect3DDevice9*);
using HookInit = int (WINAPI*)();
using CreateHook = int (WINAPI*)(void*, void*, void**);
using EnableHook = int (WINAPI*)(void*);

constexpr int panel_width = 660;
constexpr int panel_height = 430;
constexpr COLORREF ground = RGB(14, 16, 20);
constexpr COLORREF surface = RGB(22, 25, 32);
constexpr COLORREF surface_2 = RGB(29, 33, 42);
constexpr COLORREF line = RGB(42, 47, 58);
constexpr COLORREF ink = RGB(236, 238, 242);
constexpr COLORREF muted = RGB(160, 167, 180);
constexpr COLORREF accent = RGB(255, 178, 36);
constexpr COLORREF on_accent = RGB(26, 18, 0);

HINSTANCE module_instance = nullptr;
EndScene original_end_scene = nullptr;
IDirect3DTexture9* texture = nullptr;
IDirect3DDevice9* texture_device = nullptr;
IDirectInput8W* direct_input = nullptr;
IDirectInputDevice8W* mouse_device = nullptr;
HWND mouse_window = nullptr;
bool shown = false;
bool toggle_down = false;
bool mouse_down = false;
int page = 0;
DWORD refreshed = 0;
float cursor_x = panel_width / 2.0f;
float cursor_y = panel_height / 2.0f;
int position_mode = 0;
int cursor_speed = 1;
bool show_hint = true;

struct PanelPosition { float left, top; };
struct Vertex { float x, y, z, rhw, u, v; };
struct PointerVertex { float x, y, z, rhw; DWORD color; };

bool key(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

std::wstring data_folder() {
    wchar_t folder[MAX_PATH] = {};
    const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", folder, MAX_PATH);
    if (!length || length >= MAX_PATH) return L"";
    return std::wstring(folder) + L"\\TWM Market";
}

std::wstring settings_path() { return data_folder() + L"\\game-overlay.ini"; }

void load_settings() {
    const std::wstring path = settings_path();
    if (path.empty()) return;
    position_mode = std::clamp(static_cast<int>(GetPrivateProfileIntW(L"panel", L"position", 0, path.c_str())), 0, 2);
    cursor_speed = std::clamp(static_cast<int>(GetPrivateProfileIntW(L"panel", L"cursor_speed", 1, path.c_str())), 0, 2);
    show_hint = GetPrivateProfileIntW(L"panel", L"show_hint", 1, path.c_str()) != 0;
}

void save_settings() {
    const std::wstring folder = data_folder();
    if (folder.empty()) return;
    CreateDirectoryW(folder.c_str(), nullptr);
    const std::wstring path = settings_path();
    WritePrivateProfileStringW(L"panel", L"position", std::to_wstring(position_mode).c_str(), path.c_str());
    WritePrivateProfileStringW(L"panel", L"cursor_speed", std::to_wstring(cursor_speed).c_str(), path.c_str());
    WritePrivateProfileStringW(L"panel", L"show_hint", show_hint ? L"1" : L"0", path.c_str());
}

PanelPosition position(const D3DVIEWPORT9& viewport) {
    float left = (viewport.Width - float(panel_width)) / 2.0f;
    if (position_mode == 1) left = 24.0f;
    if (position_mode == 2) left = viewport.Width - float(panel_width) - 24.0f;
    return {std::max(12.0f, left), 36.0f};
}

std::wstring snapshot() {
    const std::wstring folder = data_folder();
    if (folder.empty()) return L"Не найдена папка данных Windows\f";
    const std::wstring path = folder + L"\\game-overlay.txt";
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return
        L"Нет данных от Windows-приложения.\nУстановите TWM Market 0.24.2 или новее, откройте его и войдите в аккаунт."
        L"\fПереписки появятся после запуска Windows-приложения TWM Market.";
    FILETIME modified = {}, now = {};
    if (GetFileTime(file, nullptr, nullptr, &modified)) {
        GetSystemTimeAsFileTime(&now);
        ULARGE_INTEGER last_write = {}, current = {};
        last_write.LowPart = modified.dwLowDateTime;
        last_write.HighPart = modified.dwHighDateTime;
        current.LowPart = now.dwLowDateTime;
        current.HighPart = now.dwHighDateTime;
        if (current.QuadPart > last_write.QuadPart + 120ULL * 10000000ULL) {
            CloseHandle(file);
            return L"Данные устарели. Запустите Windows-приложение TWM Market и войдите в аккаунт."
                   L"\fПереписки обновятся после запуска Windows-приложения TWM Market.";
        }
    }
    const DWORD size = GetFileSize(file, nullptr);
    if (size < 2 || size > 32768 || (size & 1)) { CloseHandle(file); return L"Данные пока не готовы\f"; }
    std::vector<wchar_t> chars(size / 2);
    DWORD read = 0;
    const BOOL ok = ReadFile(file, chars.data(), size, &read, nullptr);
    CloseHandle(file);
    if (!ok || read != size || chars[0] != 0xfeff) return L"Данные пока не готовы\f";
    return std::wstring(chars.begin() + 1, chars.end());
}

void release_texture() {
    if (texture) texture->Release();
    texture = nullptr;
    texture_device = nullptr;
}

void fill_round(HDC dc, const RECT& rect, int radius, COLORREF color) {
    HBRUSH brush = CreateSolidBrush(color);
    HGDIOBJ old_brush = SelectObject(dc, brush);
    HPEN pen = CreatePen(PS_SOLID, 1, color);
    HGDIOBJ old_pen = SelectObject(dc, pen);
    RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
    SelectObject(dc, old_pen);
    SelectObject(dc, old_brush);
    DeleteObject(pen);
    DeleteObject(brush);
}

void outline_round(HDC dc, const RECT& rect, int radius, COLORREF color) {
    HGDIOBJ old_brush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    HPEN pen = CreatePen(PS_SOLID, 1, color);
    HGDIOBJ old_pen = SelectObject(dc, pen);
    RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
    SelectObject(dc, old_pen);
    SelectObject(dc, old_brush);
    DeleteObject(pen);
}

void label(HDC dc, const wchar_t* text, RECT rect, COLORREF color, UINT align = DT_LEFT) {
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, color);
    DrawTextW(dc, text, -1, &rect, align | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
}

void draw_tab(HDC dc, const wchar_t* text, RECT rect, bool active) {
    if (active) fill_round(dc, rect, 12, surface_2);
    label(dc, text, rect, active ? ink : muted, DT_CENTER);
    if (active) fill_round(dc, {rect.left + 14, rect.bottom - 3, rect.right - 14, rect.bottom}, 3, accent);
}

void draw_button(HDC dc, const wchar_t* text, RECT rect, bool selected = false) {
    fill_round(dc, rect, 12, selected ? accent : surface_2);
    if (!selected) outline_round(dc, rect, 12, line);
    label(dc, text, rect, selected ? on_accent : ink, DT_CENTER);
}

void draw_settings(HDC dc) {
    label(dc, L"Настройки панели", {28, 112, 620, 142}, ink);
    label(dc, L"Изменения сохраняются автоматически", {28, 143, 620, 167}, muted);
    fill_round(dc, {28, 181, 632, 239}, 14, surface_2);
    label(dc, L"Положение", {44, 181, 218, 239}, ink);
    draw_button(dc, L"Слева", {230, 190, 340, 230}, position_mode == 1);
    draw_button(dc, L"По центру", {350, 190, 470, 230}, position_mode == 0);
    draw_button(dc, L"Справа", {480, 190, 590, 230}, position_mode == 2);
    fill_round(dc, {28, 251, 632, 309}, 14, surface_2);
    label(dc, L"Скорость курсора", {44, 251, 218, 309}, ink);
    draw_button(dc, L"Медленно", {230, 260, 340, 300}, cursor_speed == 0);
    draw_button(dc, L"Обычно", {350, 260, 470, 300}, cursor_speed == 1);
    draw_button(dc, L"Быстро", {480, 260, 590, 300}, cursor_speed == 2);
    fill_round(dc, {28, 321, 632, 371}, 14, surface_2);
    label(dc, L"Подсказка Ctrl+Alt+F10", {44, 321, 450, 371}, ink);
    draw_button(dc, show_hint ? L"Включено" : L"Выключено", {488, 327, 610, 365}, show_hint);
}

void update_texture(IDirect3DDevice9* device) {
    if (texture_device != device) release_texture();
    if (!texture && FAILED(device->CreateTexture(panel_width, panel_height, 1, 0, D3DFMT_A8R8G8B8,
                                                  D3DPOOL_MANAGED, &texture, nullptr))) return;
    texture_device = device;
    const std::wstring data = snapshot();
    const auto split = data.find(L'\f');
    const std::wstring content = page == 0 ? data.substr(0, split) :
        (split == std::wstring::npos ? L"Нет данных о переписках" : data.substr(split + 1));

    HDC dc = CreateCompatibleDC(nullptr);
    if (!dc) return;
    BITMAPINFO info = {};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = panel_width;
    info.bmiHeader.biHeight = -panel_height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap) { DeleteDC(dc); return; }
    HGDIOBJ old_bitmap = SelectObject(dc, bitmap);
    HBRUSH outer = CreateSolidBrush(ground);
    RECT full = {0, 0, panel_width, panel_height};
    FillRect(dc, &full, outer);
    DeleteObject(outer);
    fill_round(dc, {1, 1, panel_width - 1, panel_height - 1}, 18, surface);
    outline_round(dc, {1, 1, panel_width - 1, panel_height - 1}, 18, line);
    fill_round(dc, {18, 16, 62, 60}, 12, accent);

    HFONT logo_font = CreateFontW(19, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                  OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                  DEFAULT_PITCH, L"Segoe UI");
    HGDIOBJ old_font = SelectObject(dc, logo_font);
    label(dc, L"TW", {18, 16, 62, 60}, on_accent, DT_CENTER);
    HFONT title_font = CreateFontW(20, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                   OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                   DEFAULT_PITCH, L"Segoe UI");
    SelectObject(dc, title_font);
    label(dc, L"TWM Market", {76, 16, 270, 60}, ink);
    draw_button(dc, L"×", {604, 20, 640, 56});

    HFONT normal_font = CreateFontW(17, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                    OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                    DEFAULT_PITCH, L"Segoe UI");
    SelectObject(dc, normal_font);
    draw_tab(dc, L"Мои объявления", {18, 72, 216, 105}, page == 0);
    draw_tab(dc, L"Переписки", {224, 72, 392, 105}, page == 1);
    draw_tab(dc, L"Настройки", {400, 72, 548, 105}, page == 2);

    if (page == 2) {
        draw_settings(dc);
    } else {
        fill_round(dc, {18, 114, 642, 357}, 14, ground);
        SetTextColor(dc, ink);
        RECT body = {34, 132, 626, 341};
        DrawTextW(dc, content.c_str(), -1, &body, DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
        draw_button(dc, L"Открыть в приложении", {18, 371, 228, 413}, true);
    }
    if (show_hint) label(dc, L"Ctrl+Alt+F10 — скрыть", {430, 376, 632, 409}, muted, DT_RIGHT);

    D3DLOCKED_RECT locked = {};
    if (SUCCEEDED(texture->LockRect(0, &locked, nullptr, 0))) {
        const auto* source = static_cast<const DWORD*>(pixels);
        for (int y = 0; y < panel_height; ++y) {
            auto* target = reinterpret_cast<DWORD*>(static_cast<BYTE*>(locked.pBits) + y * locked.Pitch);
            for (int x = 0; x < panel_width; ++x) target[x] = source[y * panel_width + x] | 0xff000000;
        }
        texture->UnlockRect(0);
    }
    SelectObject(dc, old_font);
    DeleteObject(normal_font);
    DeleteObject(title_font);
    DeleteObject(logo_font);
    SelectObject(dc, old_bitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
    refreshed = GetTickCount();
}

void release_mouse() {
    if (mouse_device) { mouse_device->Unacquire(); mouse_device->Release(); }
    if (direct_input) direct_input->Release();
    mouse_device = nullptr;
    direct_input = nullptr;
    mouse_window = nullptr;
}

bool prepare_mouse(IDirect3DDevice9* device) {
    D3DDEVICE_CREATION_PARAMETERS creation = {};
    if (FAILED(device->GetCreationParameters(&creation)) || !creation.hFocusWindow) return false;
    if (mouse_device && mouse_window == creation.hFocusWindow) return true;
    release_mouse();
    if (FAILED(DirectInput8Create(module_instance, DIRECTINPUT_VERSION, IID_IDirectInput8W,
                                  reinterpret_cast<void**>(&direct_input), nullptr))) return false;
    if (FAILED(direct_input->CreateDevice(GUID_SysMouse, &mouse_device, nullptr)) ||
        FAILED(mouse_device->SetDataFormat(&c_dfDIMouse2)) ||
        FAILED(mouse_device->SetCooperativeLevel(creation.hFocusWindow, DISCL_NONEXCLUSIVE | DISCL_BACKGROUND))) {
        release_mouse();
        return false;
    }
    mouse_window = creation.hFocusWindow;
    mouse_device->Acquire();
    return true;
}

bool update_cursor(IDirect3DDevice9* device, bool& pressed) {
    if (!prepare_mouse(device)) { pressed = key(VK_LBUTTON); return true; }
    DIMOUSESTATE2 state = {};
    HRESULT result = mouse_device->GetDeviceState(sizeof(state), &state);
    if (FAILED(result)) {
        mouse_device->Acquire();
        result = mouse_device->GetDeviceState(sizeof(state), &state);
    }
    if (FAILED(result)) return false;
    const float multiplier[] = {0.65f, 1.0f, 1.55f};
    cursor_x = std::clamp(cursor_x + state.lX * multiplier[cursor_speed], 2.0f, float(panel_width - 14));
    cursor_y = std::clamp(cursor_y + state.lY * multiplier[cursor_speed], 2.0f, float(panel_height - 18));
    pressed = (state.rgbButtons[0] & 0x80) != 0;
    return true;
}

bool in_rect(float x, float y, int left, int top, int right, int bottom) {
    return x >= left && x < right && y >= top && y < bottom;
}

void handle_click() {
    if (in_rect(cursor_x, cursor_y, 18, 72, 216, 105)) { page = 0; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 224, 72, 392, 105)) { page = 1; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 400, 72, 548, 105)) { page = 2; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 604, 20, 640, 56)) shown = false;
    else if (page != 2 && in_rect(cursor_x, cursor_y, 18, 371, 228, 413)) {
        ShellExecuteW(nullptr, L"open", page == 0 ? L"twm-market://open/my/listings" :
                      L"twm-market://open/chats", nullptr, nullptr, SW_SHOWNORMAL);
    } else if (page == 2) {
        if (in_rect(cursor_x, cursor_y, 230, 190, 340, 230)) position_mode = 1;
        else if (in_rect(cursor_x, cursor_y, 350, 190, 470, 230)) position_mode = 0;
        else if (in_rect(cursor_x, cursor_y, 480, 190, 590, 230)) position_mode = 2;
        else if (in_rect(cursor_x, cursor_y, 230, 260, 340, 300)) cursor_speed = 0;
        else if (in_rect(cursor_x, cursor_y, 350, 260, 470, 300)) cursor_speed = 1;
        else if (in_rect(cursor_x, cursor_y, 480, 260, 590, 300)) cursor_speed = 2;
        else if (in_rect(cursor_x, cursor_y, 488, 327, 610, 365)) show_hint = !show_hint;
        else return;
        save_settings();
        refreshed = 0;
    }
}

void render(IDirect3DDevice9* device) {
    D3DVIEWPORT9 viewport = {};
    if (FAILED(device->GetViewport(&viewport))) return;
    if (!texture || texture_device != device || GetTickCount() - refreshed > 5000) update_texture(device);
    if (!texture) return;
    IDirect3DStateBlock9* saved = nullptr;
    if (FAILED(device->CreateStateBlock(D3DSBT_ALL, &saved))) return;
    saved->Capture();
    const auto panel = position(viewport);
    const float left = panel.left - 0.5f, top = panel.top - 0.5f;
    const Vertex quad[] = {
        {left, top, 0, 1, 0, 0}, {left + panel_width, top, 0, 1, 1, 0},
        {left, top + panel_height, 0, 1, 0, 1},
        {left + panel_width, top + panel_height, 0, 1, 1, 1},
    };
    device->SetTexture(0, texture);
    device->SetFVF(D3DFVF_XYZRHW | D3DFVF_TEX1);
    device->SetRenderState(D3DRS_ZENABLE, FALSE);
    device->SetRenderState(D3DRS_ALPHABLENDENABLE, FALSE);
    device->SetRenderState(D3DRS_CULLMODE, D3DCULL_NONE);
    device->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_SELECTARG1);
    device->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE);
    device->SetTextureStageState(0, D3DTSS_ALPHAOP, D3DTOP_SELECTARG1);
    device->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
    device->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, quad, sizeof(Vertex));

    const float px = panel.left + cursor_x, py = panel.top + cursor_y;
    const PointerVertex shadow[] = {
        {px + 1, py + 1, 0, 1, 0xff111111}, {px + 4, py + 21, 0, 1, 0xff111111},
        {px + 11, py + 14, 0, 1, 0xff111111},
    };
    const PointerVertex pointer[] = {
        {px, py, 0, 1, 0xffffb224}, {px + 3, py + 19, 0, 1, 0xffffb224},
        {px + 10, py + 13, 0, 1, 0xffffb224},
    };
    device->SetTexture(0, nullptr);
    device->SetFVF(D3DFVF_XYZRHW | D3DFVF_DIFFUSE);
    device->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_DIFFUSE);
    device->DrawPrimitiveUP(D3DPT_TRIANGLELIST, 1, shadow, sizeof(PointerVertex));
    device->DrawPrimitiveUP(D3DPT_TRIANGLELIST, 1, pointer, sizeof(PointerVertex));
    saved->Apply();
    saved->Release();
}

HRESULT WINAPI hooked_end_scene(IDirect3DDevice9* device) {
    const bool combo = key(VK_CONTROL) && key(VK_MENU) && key(VK_F10);
    if (combo && !toggle_down) {
        shown = !shown;
        if (shown) {
            cursor_x = panel_width / 2.0f;
            cursor_y = panel_height / 2.0f;
            mouse_down = true;
        }
    }
    toggle_down = combo;
    if (shown) {
        bool pressed = false;
        update_cursor(device, pressed);
        if (pressed && !mouse_down) handle_click();
        mouse_down = pressed;
        if (shown) render(device);
    }
    return original_end_scene(device);
}

DWORD WINAPI worker(void*) {
    load_settings();
    HMODULE graphics = nullptr;
    for (int i = 0; i < 300 && !graphics; ++i) { graphics = GetModuleHandleW(L"d3d9.dll"); Sleep(100); }
    if (!graphics) return 1;
    HMODULE minhook = LoadLibraryW(L"MinHook.x86.dll");
    if (!minhook) return 2;
    const auto initialize = reinterpret_cast<HookInit>(GetProcAddress(minhook, "MH_Initialize"));
    const auto create = reinterpret_cast<CreateHook>(GetProcAddress(minhook, "MH_CreateHook"));
    const auto enable = reinterpret_cast<EnableHook>(GetProcAddress(minhook, "MH_EnableHook"));
    if (!initialize || !create || !enable) return 3;
    const int initialized = initialize();
    if (initialized != 0 && initialized != 1) return 3;
    HWND dummy = CreateWindowExW(0, L"STATIC", L"", WS_POPUP, 0, 0, 8, 8, nullptr, nullptr, nullptr, nullptr);
    if (!dummy) return 4;
    auto* d3d = Direct3DCreate9(D3D_SDK_VERSION);
    if (!d3d) { DestroyWindow(dummy); return 5; }
    D3DPRESENT_PARAMETERS parameters = {};
    parameters.Windowed = TRUE;
    parameters.SwapEffect = D3DSWAPEFFECT_DISCARD;
    parameters.hDeviceWindow = dummy;
    IDirect3DDevice9* device = nullptr;
    HRESULT result = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, dummy,
                                       D3DCREATE_SOFTWARE_VERTEXPROCESSING, &parameters, &device);
    if (FAILED(result)) result = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_REF, dummy,
                                                    D3DCREATE_SOFTWARE_VERTEXPROCESSING, &parameters, &device);
    if (FAILED(result)) result = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_NULLREF, dummy,
                                                    D3DCREATE_SOFTWARE_VERTEXPROCESSING, &parameters, &device);
    if (SUCCEEDED(result)) {
        void* end_scene = (*reinterpret_cast<void***>(device))[42];
        if (create(end_scene, reinterpret_cast<void*>(hooked_end_scene),
                   reinterpret_cast<void**>(&original_end_scene)) == 0) enable(end_scene);
        device->Release();
    }
    d3d->Release();
    DestroyWindow(dummy);
    return SUCCEEDED(result) ? 0 : 6;
}
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        module_instance = instance;
        DisableThreadLibraryCalls(instance);
        HANDLE thread = CreateThread(nullptr, 0, worker, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}

