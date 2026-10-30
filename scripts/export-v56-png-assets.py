#!/usr/bin/env python3
"""Create independent transparent PNG parallax parts and trim the original brand logo."""
from pathlib import Path
from PIL import Image
base=Path("public/assets/v5")
output=base/"png"
output.mkdir(parents=True,exist_ok=True)
for part in ("monitor","keyboard","printer","cable","cartridge","cursor"):
    src=base/f"{part}-layer.webp"
    image=Image.open(src).convert("RGBA")
    image.save(output/f"{part}-layer.png",optimize=True)
    print(part,image.size,(output/f"{part}-layer.png").stat().st_size)
logo=Image.open("public/assets/soft-tech-logo.png").convert("RGBA")
alpha=logo.getchannel("A")
bbox=alpha.point(lambda a:255 if a>8 else 0).getbbox()
if not bbox:raise RuntimeError("Original logo has no visible pixels")
pad=12
bbox=(max(0,bbox[0]-pad),max(0,bbox[1]-pad),min(logo.width,bbox[2]+pad),min(logo.height,bbox[3]+pad))
logo=logo.crop(bbox)
logo.thumbnail((440,232),Image.Resampling.LANCZOS)
logo.save(base/"soft-tech-header-cropped.png",optimize=True)
print("logo",logo.size)
