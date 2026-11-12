// UI LOCK V6.1: the approved layout, navbar, game visuals and six-layer
// orange-computer assets may not be silently changed by a typography release.
// Git blob IDs include file mode independent content bytes.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const locked = {
  "public/assets/v5/cable-layer.webp": "15ce0315edcec7c78d9d7a3ba15f56ec5e93c888",
  "public/assets/v5/cartridge-layer.webp": "0b553790e9f741293bf617f01cbfd560330c1e5d",
  "public/assets/v5/cursor-layer.webp": "3423bd16237a69e981d0cee9e72204f921535b64",
  "public/assets/v5/keyboard-layer.webp": "3dda46a9150734268fd3d328569500cf565c6943",
  "public/assets/v5/monitor-layer.webp": "68bba370b1de495a4da2a70a1f810bc8c4705114",
  "public/assets/v5/orange-computer-cutout.webp": "74337d12d06c97477216665ac7a502949cf6e71a",
  "public/assets/v5/png/cable-layer.png": "1fbf846e399bb956afaef9ad3be9175a3a297bc5",
  "public/assets/v5/png/cartridge-layer.png": "77d5bb7f6623661488003fd28c474e505f4a866a",
  "public/assets/v5/png/cursor-layer.png": "bdb5bfe7d981de7d042156b96a359469a0e372af",
  "public/assets/v5/png/keyboard-layer.png": "f25463b64f0277b5dcb4d23aa2b496ad35913e7d",
  "public/assets/v5/png/monitor-layer.png": "8e9ddc9ff07822982f309de9ee583d7ca4908697",
  "public/assets/v5/png/printer-layer.png": "2debe5b7e5587da76e08c3b18e1cae6ed1c94aa8",
  "public/assets/v5/printer-layer.webp": "9a806d52dfb0039fbe367c8d9ac4d05b5e7f4f62",
  "public/assets/v5/soft-tech-header-cropped.png": "3c852163809ddccc36c044c8e65eb06189a6c00b",
  "public/assets/v5/soft-tech-neon-header.webp": "d010928fc425639ec4a3e1f4ab357471bab54759",
  "src/app/globals.css": "f6df23e67de1e8fb157cc933d420cea575af6ad6",
  "src/app/v4-responsive.css": "986c0e41f03ee7dd1e03c8291aab0cdd300da37e",
  "src/app/v4.css": "4e73c56dc48413ad732e8b63ba18e7403b7a36cc",
  "src/app/v5-desktop.css": "1b7215c48244951bd662d48121f1c7821bfdd2ea",
  "src/app/v52-mobile.css": "bc73db7c90e31ad7f896865d306bf58eb7733547",
  "src/app/v57-unified-ui.css": "fb9eb8fb6fd082c66764974844c9c539092d490e",
  "src/app/v58-landscape-games.css": "e6bc61d924c87d917a61c8931d9d58e659d0f83e",
  "src/components/motion.tsx": "6eb8e5bb0e5fac653d31a8fcbd7fa4a3e09de5d1",
  "src/components/portal.tsx": "2768e7b06f5191b4490798ac81755ca9d3ff57ee",
  "src/components/v5-desktop-hero.tsx": "7d18d6aa0fc5fc6bf201d0454357dc8692a6e3bb",
  "src/components/v52-mobile-hero.tsx": "948ab0371454d75673585392435cc606ff56ae2d",
  "src/data/games.ts": "a67131b146637c0ea041c1f83dd78c2196e9ae0c",
  "public/fonts/Minecraft.woff2": "24a32947adfdc19d2bc5745ae99cb6a8b5375f95"
};
const failures=[];
for (const [path,expected] of Object.entries(locked)) {
  try {
    const bytes=readFileSync(path);
    const actual=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    if(actual!==expected) failures.push(path+": expected "+expected+", found "+actual);
  } catch(err) {
    failures.push(path+": "+err.message);
  }
}
if (failures.length) {
  console.error("V6.1 UI LOCK FAILED\n"+failures.map(x=>" - "+x).join("\n"));
  process.exitCode=1;
} else {
  console.log("V6.1 UI LOCK PASSED: "+Object.keys(locked).length+
    " original structure, style and asset files match approved hashes");
}
