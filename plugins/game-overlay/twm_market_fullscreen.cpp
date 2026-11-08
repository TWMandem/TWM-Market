#define UNICODE
#define _UNICODE
#define NOMINMAX
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
using DeviceState = HRESULT (WINAPI*)(IDirectInputDevice8W*, DWORD, LPVOID);
using DeviceData = HRESULT (WINAPI*)(IDirectInputDevice8W*, DWORD, LPDIDEVICEOBJECTDATA, LPDWORD, DWORD);

constexpr int panel_width = 820;
constexpr int panel_height = 520;
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
WNDPROC original_wnd_proc = nullptr;
DeviceState original_mouse_state = nullptr;
DeviceState original_keyboard_state = nullptr;
DeviceData original_mouse_data = nullptr;
DeviceData original_keyboard_data = nullptr;
bool shown = false;
bool toggle_down = false;
bool mouse_down = false;
int page = 0; // 0 — обзор, 1 — объявления, 2 — сообщения, 3 — избранное, 4 — уведомления, 5 — настройки.
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

HRESULT WINAPI hooked_mouse_state(IDirectInputDevice8W* device, DWORD size, LPVOID data) {
    const HRESULT result = original_mouse_state(device, size, data);
    if (shown && device != mouse_device && SUCCEEDED(result) && data) ZeroMemory(data, size);
    return result;
}

HRESULT WINAPI hooked_keyboard_state(IDirectInputDevice8W* device, DWORD size, LPVOID data) {
    const HRESULT result = original_keyboard_state(device, size, data);
    if (shown && SUCCEEDED(result) && data) ZeroMemory(data, size);
    return result;
}

HRESULT WINAPI hooked_mouse_data(IDirectInputDevice8W* device, DWORD object_size,
                                  LPDIDEVICEOBJECTDATA data, LPDWORD count, DWORD flags) {
    const HRESULT result = original_mouse_data(device, object_size, data, count, flags);
    if (shown && device != mouse_device && count) *count = 0;
    return result;
}

HRESULT WINAPI hooked_keyboard_data(IDirectInputDevice8W* device, DWORD object_size,
                                     LPDIDEVICEOBJECTDATA data, LPDWORD count, DWORD flags) {
    const HRESULT result = original_keyboard_data(device, object_size, data, count, flags);
    if (shown && count) *count = 0;
    return result;
}

LRESULT CALLBACK overlay_wnd_proc(HWND window, UINT message, WPARAM w_param, LPARAM l_param) {
    if (shown) {
        switch (message) {
            case WM_INPUT:
            case WM_MOUSEMOVE:
            case WM_MOUSEWHEEL:
            case WM_MOUSEHWHEEL:
            case WM_LBUTTONDOWN: case WM_LBUTTONUP: case WM_LBUTTONDBLCLK:
            case WM_RBUTTONDOWN: case WM_RBUTTONUP: case WM_RBUTTONDBLCLK:
            case WM_MBUTTONDOWN: case WM_MBUTTONUP: case WM_MBUTTONDBLCLK:
            case WM_XBUTTONDOWN: case WM_XBUTTONUP: case WM_XBUTTONDBLCLK:
            case WM_KEYDOWN: case WM_KEYUP:
            case WM_SYSKEYDOWN: case WM_SYSKEYUP:
            case WM_CHAR: case WM_SYSCHAR:
                return 0;
        }
    }
    return original_wnd_proc ? CallWindowProcW(original_wnd_proc, window, message, w_param, l_param)
                             : DefWindowProcW(window, message, w_param, l_param);
}

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

std::vector<std::wstring> split_sections(const std::wstring& data) {
    std::vector<std::wstring> sections;
    size_t start = 0;
    while (start <= data.size()) {
        const size_t separator = data.find(L'\f', start);
        sections.push_back(data.substr(start, separator == std::wstring::npos ? data.size() - start : separator - start));
        if (separator == std::wstring::npos) break;
        start = separator + 1;
    }
    while (sections.size() < 5) sections.push_back(L"Данные пока не готовы");
    return sections;
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
    label(dc, text, {rect.left + 18, rect.top, rect.right - 8, rect.bottom}, active ? ink : muted);
    if (active) fill_round(dc, {rect.left, rect.top + 9, rect.left + 4, rect.bottom - 9}, 4, accent);
}

void draw_button(HDC dc, const wchar_t* text, RECT rect, bool selected = false) {
    fill_round(dc, rect, 12, selected ? accent : surface_2);
    if (!selected) outline_round(dc, rect, 12, line);
    label(dc, text, rect, selected ? on_accent : ink, DT_CENTER);
}

void draw_settings(HDC dc) {
    label(dc, L"Настройки панели", {246, 96, 775, 126}, ink);
    label(dc, L"Изменения сохраняются автоматически", {246, 126, 775, 150}, muted);
    fill_round(dc, {238, 166, 786, 226}, 14, surface_2);
    label(dc, L"Положение", {254, 166, 392, 226}, ink);
    draw_button(dc, L"Слева", {398, 176, 508, 216}, position_mode == 1);
    draw_button(dc, L"По центру", {518, 176, 638, 216}, position_mode == 0);
    draw_button(dc, L"Справа", {648, 176, 766, 216}, position_mode == 2);
    fill_round(dc, {238, 240, 786, 300}, 14, surface_2);
    label(dc, L"Скорость курсора", {254, 240, 392, 300}, ink);
    draw_button(dc, L"Медленно", {398, 250, 508, 290}, cursor_speed == 0);
    draw_button(dc, L"Обычно", {518, 250, 638, 290}, cursor_speed == 1);
    draw_button(dc, L"Быстро", {648, 250, 766, 290}, cursor_speed == 2);
    fill_round(dc, {238, 314, 786, 372}, 14, surface_2);
    label(dc, L"Подсказка Ctrl+Alt+F10", {254, 314, 620, 372}, ink);
    draw_button(dc, show_hint ? L"Включено" : L"Выключено", {642, 324, 766, 362}, show_hint);
}

void update_texture(IDirect3DDevice9* device) {
    if (texture_device != device) release_texture();
    if (!texture && FAILED(device->CreateTexture(panel_width, panel_height, 1, 0, D3DFMT_A8R8G8B8,
                                                  D3DPOOL_MANAGED, &texture, nullptr))) return;
    texture_device = device;
    const auto sections = split_sections(snapshot());
    const std::wstring content = page < 5 ? sections[page] : L"";

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
    label(dc, L"TWM Market", {76, 16, 310, 60}, ink);
    label(dc, L"Игровая панель", {315, 16, 500, 60}, muted);
    draw_button(dc, L"×", {764, 20, 800, 56});

    HFONT normal_font = CreateFontW(17, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                    OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                    DEFAULT_PITCH, L"Segoe UI");
    SelectObject(dc, normal_font);
    fill_round(dc, {18, 78, 214, 502}, 16, ground);
    draw_tab(dc, L"Обзор", {30, 94, 202, 140}, page == 0);
    draw_tab(dc, L"Мои объявления", {30, 146, 202, 192}, page == 1);
    draw_tab(dc, L"Сообщения", {30, 198, 202, 244}, page == 2);
    draw_tab(dc, L"Избранное", {30, 250, 202, 296}, page == 3);
    draw_tab(dc, L"Уведомления", {30, 302, 202, 348}, page == 4);
    draw_tab(dc, L"Настройки", {30, 400, 202, 446}, page == 5);
    label(dc, L"Ctrl+Alt+F10", {48, 458, 184, 484}, muted);

    if (page == 5) {
        draw_settings(dc);
    } else {
        const wchar_t* titles[] = {L"Обзор", L"Мои объявления", L"Сообщения", L"Избранное", L"Уведомления"};
        label(dc, titles[page], {242, 88, 780, 124}, ink);
        fill_round(dc, {230, 132, 802, 448}, 16, ground);
        SetTextColor(dc, ink);
        RECT body = {250, 152, 782, 428};
        DrawTextW(dc, content.c_str(), -1, &body, DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
        draw_button(dc, L"Открыть в приложении", {230, 462, 456, 504}, true);
    }
    if (show_hint) label(dc, L"Нажмите ещё раз, чтобы скрыть", {520, 466, 790, 500}, muted, DT_RIGHT);

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
    if (mouse_window && original_wnd_proc && IsWindow(mouse_window)) {
        SetWindowLongPtrW(mouse_window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(original_wnd_proc));
    }
    if (mouse_device) { mouse_device->Unacquire(); mouse_device->Release(); }
    if (direct_input) direct_input->Release();
    mouse_device = nullptr;
    direct_input = nullptr;
    mouse_window = nullptr;
    original_wnd_proc = nullptr;
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
    const auto current_proc = reinterpret_cast<WNDPROC>(GetWindowLongPtrW(mouse_window, GWLP_WNDPROC));
    if (current_proc != overlay_wnd_proc) {
        original_wnd_proc = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(
            mouse_window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(overlay_wnd_proc)));
    }
    mouse_device->Acquire();
    return true;
}

void install_direct_input_hooks(CreateHook create, EnableHook enable) {
    IDirectInput8W* input = nullptr;
    IDirectInputDevice8W* mouse = nullptr;
    IDirectInputDevice8W* keyboard = nullptr;
    if (FAILED(DirectInput8Create(module_instance, DIRECTINPUT_VERSION, IID_IDirectInput8W,
                                  reinterpret_cast<void**>(&input), nullptr))) return;
    input->CreateDevice(GUID_SysMouse, &mouse, nullptr);
    input->CreateDevice(GUID_SysKeyboard, &keyboard, nullptr);
    if (mouse) {
        void** mouse_table = *reinterpret_cast<void***>(mouse);
        void* state_target = mouse_table[9];
        void* data_target = mouse_table[10];
        if (create(state_target, reinterpret_cast<void*>(hooked_mouse_state),
                   reinterpret_cast<void**>(&original_mouse_state)) == 0) enable(state_target);
        if (create(data_target, reinterpret_cast<void*>(hooked_mouse_data),
                   reinterpret_cast<void**>(&original_mouse_data)) == 0) enable(data_target);
        if (keyboard) {
            void** keyboard_table = *reinterpret_cast<void***>(keyboard);
            if (keyboard_table[9] != state_target &&
                create(keyboard_table[9], reinterpret_cast<void*>(hooked_keyboard_state),
                       reinterpret_cast<void**>(&original_keyboard_state)) == 0) enable(keyboard_table[9]);
            if (keyboard_table[10] != data_target &&
                create(keyboard_table[10], reinterpret_cast<void*>(hooked_keyboard_data),
                       reinterpret_cast<void**>(&original_keyboard_data)) == 0) enable(keyboard_table[10]);
        }
    }
    if (keyboard) keyboard->Release();
    if (mouse) mouse->Release();
    input->Release();
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
    if (in_rect(cursor_x, cursor_y, 30, 94, 202, 140)) { page = 0; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 30, 146, 202, 192)) { page = 1; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 30, 198, 202, 244)) { page = 2; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 30, 250, 202, 296)) { page = 3; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 30, 302, 202, 348)) { page = 4; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 30, 400, 202, 446)) { page = 5; refreshed = 0; }
    else if (in_rect(cursor_x, cursor_y, 764, 20, 800, 56)) shown = false;
    else if (page < 5 && in_rect(cursor_x, cursor_y, 230, 462, 456, 504)) {
        const wchar_t* links[] = {
            L"twm-market://open/account", L"twm-market://open/my/listings",
            L"twm-market://open/chats", L"twm-market://open/favorites",
            L"twm-market://open/account",
        };
        ShellExecuteW(nullptr, L"open", links[page], nullptr, nullptr, SW_SHOWNORMAL);
    } else if (page == 5) {
        if (in_rect(cursor_x, cursor_y, 398, 176, 508, 216)) position_mode = 1;
        else if (in_rect(cursor_x, cursor_y, 518, 176, 638, 216)) position_mode = 0;
        else if (in_rect(cursor_x, cursor_y, 648, 176, 766, 216)) position_mode = 2;
        else if (in_rect(cursor_x, cursor_y, 398, 250, 508, 290)) cursor_speed = 0;
        else if (in_rect(cursor_x, cursor_y, 518, 250, 638, 290)) cursor_speed = 1;
        else if (in_rect(cursor_x, cursor_y, 648, 250, 766, 290)) cursor_speed = 2;
        else if (in_rect(cursor_x, cursor_y, 642, 324, 766, 362)) show_hint = !show_hint;
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
    install_direct_input_hooks(create, enable);
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

