#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>

namespace {
constexpr int kHotkey = 1;
constexpr int kListings = 101;
constexpr int kMeeting = 102;
constexpr int kOpen = 103;
HWND g_text = nullptr;
int g_page = 0;

std::wstring snapshot() {
    wchar_t folder[MAX_PATH] = {};
    const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", folder, MAX_PATH);
    if (!length || length >= MAX_PATH) return L"Не найдена папка данных Windows\f";
    const std::wstring path = std::wstring(folder) + L"\\TWM Market\\game-overlay.txt";
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return L"Откройте TWM Market и войдите в аккаунт\fНет данных о встрече";
    const DWORD size = GetFileSize(file, nullptr);
    if (size < 2 || size > 32768 || size % 2) { CloseHandle(file); return L"Данные пока не готовы\f"; }
    std::vector<wchar_t> chars(size / 2);
    DWORD read = 0;
    const BOOL ok = ReadFile(file, chars.data(), size, &read, nullptr);
    CloseHandle(file);
    if (!ok || read != size || chars[0] != 0xfeff) return L"Данные пока не готовы\f";
    return std::wstring(chars.begin() + 1, chars.end());
}

void refresh() {
    const std::wstring data = snapshot();
    const auto split = data.find(L'\f');
    const std::wstring page = g_page == 0 ? data.substr(0, split) :
        (split == std::wstring::npos ? L"Нет данных о встрече" : data.substr(split + 1));
    SetWindowTextW(g_text, page.c_str());
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_CREATE: {
        CreateWindowW(L"BUTTON", L"Мои объявления", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      12, 12, 160, 35, window, reinterpret_cast<HMENU>(kListings), nullptr, nullptr);
        CreateWindowW(L"BUTTON", L"Встреча", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      180, 12, 125, 35, window, reinterpret_cast<HMENU>(kMeeting), nullptr, nullptr);
        CreateWindowW(L"BUTTON", L"Открыть TWM Market", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      313, 12, 170, 35, window, reinterpret_cast<HMENU>(kOpen), nullptr, nullptr);
        g_text = CreateWindowW(L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_VSCROLL |
                               ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL,
                               12, 58, 471, 315, window, nullptr, nullptr, nullptr);
        SendMessageW(g_text, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
        refresh();
        SetTimer(window, 1, 10000, nullptr);
        return 0;
    }
    case WM_HOTKEY:
        if (wparam == kHotkey) {
            if (IsWindowVisible(window)) ShowWindow(window, SW_HIDE);
            else { refresh(); ShowWindow(window, SW_SHOW); SetForegroundWindow(window); }
        }
        return 0;
    case WM_TIMER: if (IsWindowVisible(window)) refresh(); return 0;
    case WM_COMMAND:
        if (LOWORD(wparam) == kListings || LOWORD(wparam) == kMeeting) {
            g_page = LOWORD(wparam) == kMeeting; refresh();
        } else if (LOWORD(wparam) == kOpen) {
            const wchar_t* url = g_page ? L"twm-market://open/chats" : L"twm-market://open/my/listings";
            ShellExecuteW(window, L"open", url, nullptr, nullptr, SW_SHOWNORMAL);
        }
        return 0;
    case WM_CLOSE: ShowWindow(window, SW_HIDE); return 0;
    case WM_DESTROY: UnregisterHotKey(window, kHotkey); return 0;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

DWORD WINAPI worker(void* module) {
    HINSTANCE instance = static_cast<HINSTANCE>(module);
    WNDCLASSW wc = {};
    wc.lpfnWndProc = window_proc;
    wc.hInstance = instance;
    wc.lpszClassName = L"TWMMarketGameOverlay";
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!RegisterClassW(&wc)) return 1;
    HWND window = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, wc.lpszClassName,
                                  L"TWM Market · Ctrl+Shift+M", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                                  CW_USEDEFAULT, CW_USEDEFAULT, 510, 420,
                                  nullptr, nullptr, instance, nullptr);
    if (!window) return 2;
    RegisterHotKey(window, kHotkey, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 'M');
    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return 0;
}
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(instance);
        HANDLE thread = CreateThread(nullptr, 0, worker, instance, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}

