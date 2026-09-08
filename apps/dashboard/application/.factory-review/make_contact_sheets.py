from pathlib import Path
import sys

from PIL import Image, ImageOps


root = Path(sys.argv[1])
files = sorted(root.glob("page-*.png"))
for sheet_index in range(0, len(files), 4):
    page_files = files[sheet_index : sheet_index + 4]
    canvas = Image.new("RGB", (2000, 2600), "white")
    for page_index, page_file in enumerate(page_files):
        with Image.open(page_file) as source:
            page = ImageOps.contain(source.convert("RGB"), (1000, 1300))
        x = (page_index % 2) * 1000
        y = (page_index // 2) * 1300
        canvas.paste(page, (x, y))
    canvas.save(root / f"sheet-{sheet_index // 4 + 1}.png")
