# assets/ —— 可选素材（缺失时全部有程序化兜底）

| 素材 | 放到哪里 | 说明 |
|---|---|---|
| Sketchfab “Bar Diorama” | `models/bar_diorama.glb` | 下载 glTF/GLB 格式。节点名/材质名含 pool / billiard / snooker 的网格会被隐藏，并按此包围盒把我们的球桌对齐到模型里。找不到时在 `config.json` 里设 `bar.hide`（节点名数组）或手动 `scale/rotY/offset`。**请按模型页面上的作者与许可署名。** |
| Poly Haven 胡桃木 | `textures/walnut_diff.jpg` | 漫反射贴图即可（CC0）。 |
| Poly Haven fireplace HDRI | `hdri/fireplace_1k.hdr` | CC0。 |
| Freesound 台球采样 | `audio/*.ogg` + `audio/manifest.json` | 参考 `manifest.example.json`；支持切片。 |
| Lounge jazz BGM | `audio/bgm.mp3`（或 .ogg/.m4a） | 你自己提供，请确认授权。缺失时用程序化爵士垫音。 |
| 其它配置 | `config.json` | 参考 `config.example.json`。 |

没有这些文件也能玩：房间、木纹、球面、镖盘、霓虹、音效、BGM 都有程序化版本。
设置 → 关于 · 开源材质与许可 里能看到每项当前是“已加载”还是“程序化兜底”。
