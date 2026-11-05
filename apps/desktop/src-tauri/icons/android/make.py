"""Иконки приложения для Android (адаптивные: фон цветом + знак отдельным слоем).

Знак (TW и столбики) вписан в безопасную зону 66 dp из 108 dp, чтобы
любая маска лаунчера (круг, капля, скруглённый квадрат) его не обрезала.
Запуск: python3 make.py (нужен rsvg-convert). Картинки кладутся в res/.
"""
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
AMBER = "#FFB224"
INK = "#1A1200"
GLYPHS = """
    <rect x="168" y="250" width="296" height="84" rx="10"/>
    <rect x="274" y="250" width="84" height="380" rx="10"/>
    <path d="M488 250 h88 l52 236 l50 -186 h66 l50 186 l52 -236 h88 l-98 380 h-78 l-46 -170 l-46 170 h-78 z"/>
    <rect x="392" y="736" width="64" height="48" rx="10" opacity="0.45"/>
    <rect x="480" y="704" width="64" height="80" rx="10" opacity="0.7"/>
    <rect x="568" y="660" width="64" height="124" rx="10"/>
"""
# Границы знака в исходной картинке 1024×1024.
X0, X1, Y0, Y1 = 168, 934, 250, 784


def glyphs(width: float, color: str = INK) -> str:
    """Знак шириной width (из 1024), по центру холста."""
    s = width / (X1 - X0)
    cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
    return f'<g fill="{color}" transform="translate(512 512) scale({s:.4f}) translate({-cx} {-cy})">{GLYPHS}</g>'


def svg(body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{body}</svg>'


LAYERS = {
    # Адаптивная иконка (Android 8+): прозрачный слой со знаком, фон — цвет.
    "ic_launcher_foreground": (svg(glyphs(500)), 108),
    # Тематическая иконка (Android 13+): лаунчер сам перекрашивает знак.
    "ic_launcher_monochrome": (svg(glyphs(500, "#000000")), 108),
    # Старые Android (до 8): готовая картинка.
    "ic_launcher": (svg(f'<rect x="64" y="64" width="896" height="896" rx="200" fill="{AMBER}"/>' + glyphs(560)), 48),
    "ic_launcher_round": (svg(f'<circle cx="512" cy="512" r="448" fill="{AMBER}"/>' + glyphs(520)), 48),
}
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

for name, (source, dp) in LAYERS.items():
    path = os.path.join(HERE, f"{name}.svg")
    with open(path, "w", encoding="utf-8") as f:
        f.write(source)
    for density, k in DENSITIES.items():
        out_dir = os.path.join(HERE, "res", f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        size = round(dp * k)
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", os.path.join(out_dir, f"{name}.png"), path], check=True)
