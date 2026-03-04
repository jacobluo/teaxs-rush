/**
 * 扑克牌 Canvas 绘制：像素风牌面、牌背、花色点阵
 */

const CardRenderer = {
    CARD_W: 48,
    CARD_H: 68,

    // 花色像素点阵（8x8 简化）
    suitPixels: {
        '♠': [
            '...##...',
            '..####..',
            '.######.',
            '########',
            '########',
            '...##...',
            '..####..',
            '........',
        ],
        '♥': [
            '.##..##.',
            '########',
            '########',
            '########',
            '.######.',
            '..####..',
            '...##...',
            '........',
        ],
        '♦': [
            '...##...',
            '..####..',
            '.######.',
            '########',
            '.######.',
            '..####..',
            '...##...',
            '........',
        ],
        '♣': [
            '...##...',
            '..####..',
            '.##..##.',
            '########',
            '########',
            '...##...',
            '..####..',
            '........',
        ],
    },

    suitColors: {
        '♠': '#2A4A6B',
        '♥': '#E06060',
        '♦': '#E06060',
        '♣': '#2A4A6B',
    },

    drawCard(ctx, card, x, y, scale = 1) {
        const w = this.CARD_W * scale;
        const h = this.CARD_H * scale;

        // 牌面背景
        ctx.fillStyle = '#E0F0FF';
        ctx.fillRect(x, y, w, h);

        // 边框
        ctx.strokeStyle = '#2A4A6B';
        ctx.lineWidth = 2 * scale;
        ctx.strokeRect(x, y, w, h);

        if (!card || !card.rank) return;

        const suitSymbol = card.suit;
        const rankText = card.rank;
        const suitColor = this.suitColors[suitSymbol] || '#2A4A6B';

        // 左上角点数
        ctx.fillStyle = suitColor;
        ctx.font = `${Math.floor(12 * scale)}px "Press Start 2P", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(rankText, x + 4 * scale, y + 14 * scale);

        // 左上角花色小
        ctx.font = `${Math.floor(10 * scale)}px serif`;
        ctx.fillText(suitSymbol, x + 4 * scale, y + 26 * scale);

        // 中央花色（像素点阵）
        this._drawPixelSuit(ctx, suitSymbol, x + w / 2 - 8 * scale, y + h / 2 - 6 * scale, scale, suitColor);

        // 右下角（倒置）
        ctx.save();
        ctx.translate(x + w, y + h);
        ctx.rotate(Math.PI);
        ctx.fillStyle = suitColor;
        ctx.font = `${Math.floor(12 * scale)}px "Press Start 2P", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(rankText, 4 * scale, 14 * scale);
        ctx.font = `${Math.floor(10 * scale)}px serif`;
        ctx.fillText(suitSymbol, 4 * scale, 26 * scale);
        ctx.restore();
    },

    drawCardBack(ctx, x, y, scale = 1) {
        const w = this.CARD_W * scale;
        const h = this.CARD_H * scale;

        // 牌背
        ctx.fillStyle = '#5B9BD5';
        ctx.fillRect(x, y, w, h);

        // 边框
        ctx.strokeStyle = '#2A4A6B';
        ctx.lineWidth = 2 * scale;
        ctx.strokeRect(x, y, w, h);

        // 内框装饰
        ctx.strokeStyle = '#87CEEB';
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(x + 4 * scale, y + 4 * scale, w - 8 * scale, h - 8 * scale);

        // 中心菱形图案
        const cx = x + w / 2;
        const cy = y + h / 2;
        const s = 8 * scale;
        ctx.fillStyle = '#87CEEB';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx, cy + s);
        ctx.lineTo(cx - s, cy);
        ctx.closePath();
        ctx.fill();
    },

    drawCardDimmed(ctx, card, x, y, scale = 1) {
        // 绘制置灰的牌面（用于弃牌玩家）
        ctx.save();
        ctx.globalAlpha = 0.35;
        this.drawCard(ctx, card, x, y, scale);
        ctx.restore();
    },

    _drawPixelSuit(ctx, suit, x, y, scale, color) {
        const pixels = this.suitPixels[suit];
        if (!pixels) return;

        const pxSize = 2 * scale;
        ctx.fillStyle = color;

        for (let row = 0; row < pixels.length; row++) {
            for (let col = 0; col < pixels[row].length; col++) {
                if (pixels[row][col] === '#') {
                    ctx.fillRect(
                        x + col * pxSize,
                        y + row * pxSize,
                        pxSize,
                        pxSize
                    );
                }
            }
        }
    },
};
