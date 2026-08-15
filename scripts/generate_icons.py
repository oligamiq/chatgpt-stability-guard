#!/usr/bin/env python3
from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
STORE = ROOT / "store-assets"
SVG = ICONS / "icon.svg"
BASE = 128
SS = 8


def num(value: str | None, default: float = 0) -> float:
    return float(value) if value is not None else default


def pts(value: str, zoom: float):
    out = []
    for pair in value.replace("\n", " ").split():
        x, y = map(float, pair.split(","))
        out.append(((64 + (x - 64) * zoom) * SS,
                    (64 + (y - 64) * zoom) * SS))
    return out


def tag_name(element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def render(size: int, pad: int | None = None) -> Image.Image:
    root = ET.parse(SVG).getroot()
    if pad is None:
        pad = {16: 1, 32: 2, 48: 4, 128: 0}[size]
    zoom = (64 - (128 * pad / size)) / 48
    image = Image.new("RGBA", (BASE * SS, BASE * SS), (7, 89, 133, 0))
    draw = ImageDraw.Draw(image)
    tr = lambda v: (64 + (v - 64) * zoom) * SS
    for element in root:
        kind = tag_name(element)
        fill = element.get("fill", "none")
        if kind == "rect":
            x, y = tr(num(element.get("x"))), tr(num(element.get("y")))
            w = num(element.get("width")) * zoom * SS
            h = num(element.get("height")) * zoom * SS
            r = num(element.get("rx")) * zoom * SS
            draw.rounded_rectangle((x, y, x + w, y + h), radius=r, fill=fill)
        elif kind == "polygon":
            draw.polygon(pts(element.get("points", ""), zoom), fill=fill)
        elif kind == "polyline":
            points = pts(element.get("points", ""), zoom)
            stroke = element.get("stroke", "#ffffff")
            width = max(1, round(num(element.get("stroke-width"), 1) * zoom * SS))
            draw.line(points, fill=stroke, width=width, joint="curve")
            if element.get("stroke-linecap") == "round":
                radius = width / 2
                for x, y in (points[0], points[-1]):
                    draw.ellipse((x-radius, y-radius, x+radius-1, y+radius-1), fill=stroke)
    result = image.resize((size, size), Image.Resampling.LANCZOS)
    clip = Image.new("L", (size, size), 0)
    ImageDraw.Draw(clip).rectangle((pad, pad, size-pad-1, size-pad-1), fill=255)
    result.putalpha(ImageChops.multiply(result.getchannel("A"), clip))
    return result


def main() -> None:
    ICONS.mkdir(exist_ok=True)
    STORE.mkdir(exist_ok=True)
    generated = {}
    for size in (16, 32, 48, 128):
        generated[size] = render(size)
        generated[size].save(ICONS / f"icon{size}.png", "PNG", optimize=True)
    render(128, pad=16).save(STORE / "icon-128.png", "PNG", optimize=True)
    render(300, pad=38).save(STORE / "edge-logo-300.png", "PNG", optimize=True)


if __name__ == "__main__":
    main()
