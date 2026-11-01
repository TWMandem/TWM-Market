// В релизной сборке не открываем лишнее консольное окно на Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    twm_market_lib::run()
}
