# 翻页固定美术与电影分支

`leaf-textures/` 为本项目脚本原创绘制的档案样页、纸签、规整记录线及抽象印记。内容标有“示例 / SAMPLE”或“档案样页 / STUDY”，不代表当前玩家、人物或故事记录；没有引入外部照片、下载素材或图像生成服务。纸签是附着于翻页纹理的固定美术图案，不是新增悬浮几何。

可编辑 SVG 与对应 4096×2500 RGBA 纹理由 `model-src/cinematic/leaf_artwork.py` 同时生成；字体复用项目内 Noto Sans SC，字体许可为 SIL Open Font License 1.1。贴图接入使用 `leaf_archive.py`，`leaf_reverse.py` 给原有纸张厚度的反面指定独立示例贴图，避免正面字被镜像到背面；不改变纸张几何、相机、光照、翻页形变和物体轮廓。最终源为 `grey-crow-page-reveal-two-sided.blend`；`grey-crow-page-reveal.blend` 保留为早段正面帧的可编辑来源。

影片由 `leaf_movie.py` 合并原电影未受影响帧、正面研究帧50–79和最终双面帧80–104，并保留每帧来源记录及指纹。原场景、旧电影与六张静帧均不覆盖。当前低内存制作入口为 `leaf_border_run.py`：CPU 最多4线程、256像素分块，关闭跨帧场景缓存，每进程最多3帧后退出，批次串行；仍保持原生1920×1080、48采样和原有光照参数。守卫每3秒检查系统内存，可用指标低于65%或 wired 超过5GiB即终止本批子进程，保留已落盘帧。曾触发守卫的单帧 Metal 试验保留为失败证据，不作为当前推荐制作路径。

局部渲染投影完整形变翻页网格，向外留32像素边距，再将原生像素无缩放、无混色地合成回该帧原底图；被覆盖的正面研究底图单独存入 `leaf-baselines/`。区域外像素不变，因此略去印刷改色对远处间接反光的微小影响。亮色第94帧的完整 CPU 结果与局部试样独立保留在 `leaf-review/reference/` 与 `leaf-review/border-trial-light-0094.*`，最终第94帧仍采用完整结果。制作设置及通过项以 `leaf-movie-manifest.json` 的实际完成记录为准；文中的制作路径不代表全部帧已完成。

新场景与电影仍含原封面摄影羽毛：**Crow feather 01.jpg**，作者 **Vis M**，2021-05-07，[原始资料页](https://commons.wikimedia.org/wiki/File:Crow_feather_01.jpg)，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。沿用现有摄影羽片、原生中空羽轴和已完成的灰色材质解释，原 JPEG 未改写；原件 SHA-256 为 `bcab6847141fe0b818fe27c94780a3b383ca634e7de08bf4cedd27c97044941c`。包含该羽毛改作的新电影与可编辑场景沿用 CC BY-SA 4.0；不更改项目其他代码或素材的许可。

笔尖原有结构参考署名：Auckland Museum，摄影 Richard Ng，**Pen, quill (AM 686187-5).jpg**，[资料页](https://commons.wikimedia.org/wiki/File:Pen,_quill_(AM_686187-5).jpg)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。参考照片没有贴入本次新增档案页面。作者与机构不为项目背书。
