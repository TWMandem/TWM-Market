#define UNICODE
#define _UNICODE
#include <windows.h>
#include <d3d9.h>
#include <shellapi.h>
#include <string>
#include <vector>

// Панель рисуется в кадре D3D9. Файлы и память игры не читаются.
namespace {
using EndScene = HRESULT (WINAPI*)(IDirect3DDevice9*);
using HookInit = int (WINAPI*)();
using CreateHook = int (WINAPI*)(void*, void*, void**);
using EnableHook = int (WINAPI*)(void*);
EndScene original_end_scene = nullptr;
IDirect3DTexture9* texture = nullptr;
IDirect3DDevice9* texture_device = nullptr;
bool shown = false;
int page = 0;
DWORD refreshed = 0;
bool toggle_down = false;
bool mouse_down = false;
constexpr int width = 560;
constexpr int height = 360;

struct PanelPosition { float left, top; };
PanelPosition position(const D3DVIEWPORT9& viewport) {
    return {(viewport.Width > 600 ? (viewport.Width - float(width)) / 2 : 12.0f), 40.0f};
}

std::wstring snapshot() {
    wchar_t folder[MAX_PATH] = {};
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", folder, MAX_PATH);
    if (!length || length >= MAX_PATH) return L"Не найдена папка данных Windows\f";
    const std::wstring path = std::wstring(folder) + L"\\TWM Market\\game-overlay.txt";
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

bool key(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
void release_texture() { if (texture) texture->Release(); texture = nullptr; texture_device = nullptr; }

void update_texture(IDirect3DDevice9* device) {
    if (texture_device != device) release_texture();
    if (!texture && FAILED(device->CreateTexture(width, height, 1, 0, D3DFMT_A8R8G8B8,
                                                D3DPOOL_MANAGED, &texture, nullptr))) return;
    texture_device = device;
    const std::wstring data = snapshot();
    const auto split = data.find(L'\f');
    const std::wstring content = page == 0 ? data.substr(0, split) :
        (split == std::wstring::npos ? L"Нет данных о встрече" : data.substr(split + 1));
    HDC dc = CreateCompatibleDC(nullptr);
    if (!dc) return;
    BITMAPINFO info = {};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap) { DeleteDC(dc); return; }
    HGDIOBJ old_bitmap = SelectObject(dc, bitmap);
    RECT area = {0, 0, width, height};
    HBRUSH background = CreateSolidBrush(RGB(18, 20, 27));
    FillRect(dc, &area, background);
    DeleteObject(background);
    HFONT font = CreateFontW(19, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                             DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                             CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    HGDIOBJ old_font = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(245, 245, 247));
    RECT heading = {18, 10, 480, 40};
    DrawTextW(dc, L"TWM Market", -1, &heading, DT_LEFT | DT_SINGLELINE);
    RECT close = {518, 10, 550, 40};
    DrawTextW(dc, L"×", -1, &close, DT_CENTER | DT_SINGLELINE);
    HBRUSH selected = CreateSolidBrush(RGB(65, 53, 32));
    RECT active_tab = page == 0 ? RECT{18, 45, 190, 82} : RECT{199, 45, 371, 82};
    FillRect(dc, &active_tab, selected);
    DeleteObject(selected);
    RECT listings_tab = {22, 51, 186, 79};
    RECT chats_tab = {203, 51, 367, 79};
    DrawTextW(dc, L"Мои объявления", -1, &listings_tab, DT_CENTER | DT_SINGLELINE);
    DrawTextW(dc, L"Переписки", -1, &chats_tab, DT_CENTER | DT_SINGLELINE);
    RECT body = {18, 96, 545, 308};
    DrawTextW(dc, content.c_str(), -1, &body, DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
    SetTextColor(dc, RGB(165, 170, 185));
    RECT footer = {18, 321, 545, 355};
    DrawTextW(dc, L"Открыть в приложении                         Ctrl+Alt+F10 — скрыть",
              -1, &footer, DT_LEFT | DT_SINGLELINE);
    D3DLOCKED_RECT locked;
    if (SUCCEEDED(texture->LockRect(0, &locked, nullptr, 0))) {
        const auto* source = static_cast<const DWORD*>(pixels);
        for (int y = 0; y < height; ++y) {
            auto* target = reinterpret_cast<DWORD*>(static_cast<BYTE*>(locked.pBits) + y * locked.Pitch);
            for (int x = 0; x < width; ++x) target[x] = source[y * width + x] | 0xff000000;
        }
        texture->UnlockRect(0);
    }
    SelectObject(dc, old_font);
    DeleteObject(font);
    SelectObject(dc, old_bitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
    refreshed = GetTickCount();
}

struct Vertex { float x, y, z, rhw, u, v; };
struct PointerVertex { float x, y, z, rhw; DWORD color; };
bool mouse_position(IDirect3DDevice9* device, const D3DVIEWPORT9& viewport, float& x, float& y) {
    D3DDEVICE_CREATION_PARAMETERS creation = {};
    if (FAILED(device->GetCreationParameters(&creation)) || !creation.hFocusWindow) return false;
    POINT point = {};
    RECT client = {};
    if (!GetCursorPos(&point) || !ScreenToClient(creation.hFocusWindow, &point) ||
        !GetClientRect(creation.hFocusWindow, &client)) return false;
    const LONG client_width = client.right - client.left;
    const LONG client_height = client.bottom - client.top;
    if (client_width <= 0 || client_height <= 0) return false;
    const auto panel = position(viewport);
    x = float(point.x) * viewport.Width / client_width - panel.left;
    y = float(point.y) * viewport.Height / client_height - panel.top;
    return x >= 0 && x < width && y >= 0 && y < height;
}

void handle_mouse(IDirect3DDevice9* device) {
    D3DVIEWPORT9 viewport = {};
    if (FAILED(device->GetViewport(&viewport))) return;
    float x = 0, y = 0;
    const bool inside = mouse_position(device, viewport, x, y);
    const bool pressed = key(VK_LBUTTON);
    if (pressed && !mouse_down && inside) {
        if (y >= 45 && y < 83 && x >= 18 && x < 190) { page = 0; refreshed = 0; }
        else if (y >= 45 && y < 83 && x >= 199 && x < 371) { page = 1; refreshed = 0; }
        else if (y >= 8 && y < 42 && x >= 510) shown = false;
        else if (y >= 315 && x >= 18 && x < 225) {
            ShellExecuteW(nullptr, L"open", page == 0 ? L"twm-market://open/my/listings" :
                          L"twm-market://open/chats", nullptr, nullptr, SW_SHOWNORMAL);
        }
    }
    mouse_down = pressed;
}

void render(IDirect3DDevice9* device) {
    D3DVIEWPORT9 viewport;
    if (FAILED(device->GetViewport(&viewport))) return;
    if (!texture || texture_device != device || GetTickCount() - refreshed > 5000) update_texture(device);
    if (!texture) return;
    IDirect3DStateBlock9* saved = nullptr;
    if (FAILED(device->CreateStateBlock(D3DSBT_ALL, &saved))) return;
    saved->Capture();
    const auto panel = position(viewport);
    const float left = panel.left - 0.5f;
    const float top = panel.top - 0.5f;
    const Vertex quad[] = {
        {left, top, 0, 1, 0, 0}, {left + width, top, 0, 1, 1, 0},
        {left, top + height, 0, 1, 0, 1}, {left + width, top + height, 0, 1, 1, 1},
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
    float mouse_x = 0, mouse_y = 0;
    if (mouse_position(device, viewport, mouse_x, mouse_y)) {
        const float px = panel.left + mouse_x, py = panel.top + mouse_y;
        const PointerVertex pointer[] = {
            {px, py, 0, 1, 0xffffffff}, {px + 2, py + 17, 0, 1, 0xffffffff},
            {px + 12, py + 12, 0, 1, 0xffffffff},
        };
        device->SetTexture(0, nullptr);
        device->SetFVF(D3DFVF_XYZRHW | D3DFVF_DIFFUSE);
        device->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_DIFFUSE);
        device->DrawPrimitiveUP(D3DPT_TRIANGLELIST, 1, pointer, sizeof(PointerVertex));
    }
    saved->Apply();
    saved->Release();
}

HRESULT WINAPI hooked_end_scene(IDirect3DDevice9* device) {
    const bool combo = key(VK_CONTROL) && key(VK_MENU) && key(VK_F10);
    if (combo && !toggle_down) shown = !shown;
    toggle_down = combo;
    if (shown) { handle_mouse(device); if (shown) render(device); }
    return original_end_scene(device);
}

DWORD WINAPI worker(void*) {
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
    if (initialized != 0 && initialized != 1) return 3; // Другой модуль уже мог инициализировать MinHook.
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
        DisableThreadLibraryCalls(instance);
        HANDLE thread = CreateThread(nullptr, 0, worker, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}

