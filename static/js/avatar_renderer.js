/**
 * 像素风卡通头像渲染器
 * 为 5 种 AI 风格各提供一个 16x16 像素点阵卡通头像
 * 每个字符代表一种颜色，'.' 为透明
 */

const AvatarRenderer = {

    // ===== 头像点阵数据（每行严格 16 字符） =====

    avatars: {

        // 激进 - 火焰战士：红色系，头顶火焰，怒目圆睁，凶狠嘴巴
        '激进': {
            pixels: [
                '....O....O......',
                '...OO.OO.OO.....',
                '..OOORRRROOO....',
                '..OORRRRRROOO...',
                '.DDRRRRRRRRRDD..',
                '.DRRRRRRRRRRD...',
                '.DRWWKRRWWKRD...',
                '.DRWWKRRWWKRD...',
                '.DRRRRRRRRRD....',
                '.DRRKRKKRKRD....',
                '.DDRRRRRRRRDD...',
                '..DDRRRRRRDD....',
                '...DDDDDDDD.....',
                '....DRRRRD......',
                '...DDDDDDDD.....',
                '................',
            ],
            colorMap: {
                'R': '#E06060',
                'D': '#8B2020',
                'O': '#FF8C42',
                'W': '#FFFFFF',
                'K': '#0B1929',
            }
        },

        // 保守 - 盾牌学者：绿色系，圆润脸型，方框眼镜，微笑
        '保守': {
            pixels: [
                '....SSSSSS......',
                '...SSWWWWSS.....',
                '...SWWGGWWS.....',
                '....GGGGGG......',
                '...GGGGGGGG.....',
                '..GGGGGGGGGG....',
                '..GKWWKGKWWKG...',
                '..GKWWKGKWWKG...',
                '..GGKKGGGGKKG...',
                '..GGGGGGGGGG....',
                '..GGGKGGKGGG....',
                '..GGGGKKKGGG....',
                '...GGGGGGGG.....',
                '....DDDDDD......',
                '...DDDDDDDD.....',
                '................',
            ],
            colorMap: {
                'G': '#60C0A0',
                'S': '#3A7A6A',
                'W': '#FFFFFF',
                'K': '#0B1929',
                'D': '#4A9A80',
            }
        },

        // 均衡 - 精密机器人：天蓝色，方形头，天线，LED眼
        '均衡': {
            pixels: [
                '.......WW.......',
                '.......CC.......',
                '......CCCC......',
                '...DDBBBBBBDD...',
                '..DBBBBBBBBBBD..',
                '..BBBBBBBBBBBB..',
                '..BBWWWBBWWWBB..',
                '..BBWCCBBWCCBB..',
                '..BBWWWBBWWWBB..',
                '..BBBBBBBBBBBB..',
                '..BBBDDDDDDBBB..',
                '..BBBBBBBBBBBB..',
                '..DDBBBBBBBBDD..',
                '....DDDDDDDD....',
                '...DDB..BDDD....',
                '................',
            ],
            colorMap: {
                'B': '#87CEEB',
                'D': '#4A80A8',
                'W': '#FFFFFF',
                'C': '#5B9BD5',
            }
        },

        // 诈唬 - 狐狸面具：金色，尖耳朵，狡猾眯眼，嘴角上扬
        '诈唬': {
            pixels: [
                '.GD..........DG.',
                '.GGD........DGG.',
                '..GGD......DGG..',
                '..GGGGGGGGGGGG..',
                '..GGGGGGGGGGGG..',
                '..GGGGGGGGGGGG..',
                '..GKKDGGGGDKKG..',
                '..GGKKGGGGKKGG..',
                '..GGGGGGGGGGGG..',
                '..GGGGWWWWGGGG..',
                '..GGGWGGGGWGGG..',
                '..GGGGWWWWGGGG..',
                '...GGGGGGGGGG...',
                '....DDDDDDDD....',
                '...DD..DD..DD...',
                '................',
            ],
            colorMap: {
                'G': '#D4A854',
                'D': '#B87A1A',
                'W': '#FFFFFF',
                'K': '#0B1929',
            }
        },

        // 诡计 - 变色龙幽灵：浅蓝色，不对称眼睛，波浪底部，问号
        '诡计': {
            pixels: [
                '......PPP.......',
                '.....P..PP......',
                '.......PP.......',
                '......PP........',
                '....BBBBBBBB....',
                '..BBBBBBBBBBB...',
                '..BWWKBBBWKBB...',
                '..BWWKBBBWKBB...',
                '..BBBBBBBBBBB...',
                '..BBBBBBBBBBB...',
                '..BBBKKKKKBBB...',
                '..BBBBBBBBBBBB..',
                '...BBBBBBBBBB...',
                '.BBB.BBBBB.BBB..',
                '..B...BBB...B...',
                '................',
            ],
            colorMap: {
                'B': '#B0D4F1',
                'P': '#A87CFF',
                'W': '#FFFFFF',
                'K': '#0B1929',
            }
        },
    },

    /**
     * 绘制卡通头像
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} style - AI 风格名称（激进/保守/均衡/诈唬/诡计）
     * @param {number} x - 左上角 x
     * @param {number} y - 左上角 y
     * @param {number} size - 头像总尺寸（像素）
     */
    drawAvatar(ctx, style, x, y, size) {
        const avatar = this.avatars[style] || this.avatars['均衡'];
        this._drawPixelMatrix(ctx, avatar.pixels, avatar.colorMap, x, y, size);
    },

    /**
     * 通用像素点阵绘制
     */
    _drawPixelMatrix(ctx, pixels, colorMap, x, y, size) {
        const rows = pixels.length;
        const cols = Math.max(...pixels.map(r => r.length));
        const pixelSize = size / Math.max(rows, cols);

        for (let r = 0; r < rows; r++) {
            const row = pixels[r];
            for (let c = 0; c < row.length; c++) {
                const ch = row[c];
                if (ch === '.') continue;
                const color = colorMap[ch];
                if (!color) continue;
                ctx.fillStyle = color;
                ctx.fillRect(
                    x + c * pixelSize,
                    y + r * pixelSize,
                    pixelSize + 0.5,
                    pixelSize + 0.5
                );
            }
        }
    },
};
