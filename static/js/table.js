/**
 * Canvas 牌桌渲染：PokerTable 类
 */

const PokerTable = {
    canvas: null,
    ctx: null,
    state: null,
    animFrame: null,
    _blinkTimer: null,
    _blinkOn: true,

    // AI 头像颜色列表（每个玩家分配不同颜色）
    avatarColors: [
        '#E06060', '#60C0A0', '#87CEEB', '#D4A854', '#B0D4F1',
        '#FF8C42', '#A87CFF', '#FF6B9D', '#5BCC7E',
    ],

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this._resize();
        window.addEventListener('resize', () => this._resize());
        this._startBlinkLoop();
        this._render();
    },

    _startBlinkLoop() {
        this._blinkTimer = setInterval(() => {
            this._blinkOn = !this._blinkOn;
            this._render();
        }, 500);
    },

    _resize() {
        const wrapper = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = wrapper.clientWidth * dpr;
        this.canvas.height = wrapper.clientHeight * dpr;
        this.ctx.scale(dpr, dpr);
        this.W = wrapper.clientWidth;
        this.H = wrapper.clientHeight;
    },

    updateState(state) {
        this.state = state;
        this._render();
    },

    _render() {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, this.W, this.H);

        ctx.fillStyle = '#0B1929';
        ctx.fillRect(0, 0, this.W, this.H);

        // 牌桌
        const tableW = this.W * 0.6;
        const tableH = this.H * 0.42;
        const tableX = (this.W - tableW) / 2;
        const tableY = (this.H - tableH) / 2;

        ctx.fillStyle = '#1A3A4A';
        ctx.fillRect(tableX, tableY, tableW, tableH);

        ctx.strokeStyle = '#87CEEB';
        ctx.lineWidth = 3;
        ctx.strokeRect(tableX, tableY, tableW, tableH);

        if (!this.state || !this.state.players) {
            ctx.fillStyle = '#7A9BB5';
            ctx.font = '18px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('等待游戏配置...', this.W / 2, this.H / 2);
            return;
        }

        const players = this.state.players;
        const positions = this._getPlayerPositions(players.length, tableX, tableY, tableW, tableH);

        // 绘制公共牌
        this._drawCommunityCards(ctx, this.state.community_cards || []);

        // 绘制底池
        if (this.state.pot > 0) {
            ctx.fillStyle = '#D4A854';
            ctx.font = '16px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`底池: $${this.state.pot}`, this.W / 2, tableY + tableH / 2 - 50);
        }

        // 绘制玩家 + 金币
        const thinkingId = this.state.thinking_player_id || null;
        const sbIndex = this.state.sb_index;
        const bbIndex = this.state.bb_index;
        players.forEach((p, i) => {
            if (i < positions.length) {
                const isThinking = (thinkingId && p.id === thinkingId);
                const blindTag = (i === sbIndex) ? 'SB' : (i === bbIndex) ? 'BB' : null;
                this._drawPlayer(ctx, p, positions[i], i === this.state.dealer_index, i, isThinking, blindTag);
                // 绘制该玩家在牌桌上投入的金币
                if (p.total_bet > 0 && !p.is_eliminated) {
                    this._drawPlayerChips(ctx, p.total_bet, positions[i], tableX, tableY, tableW, tableH);
                }
            }
        });
    },

    _getPlayerPositions(count, tx, ty, tw, th) {
        const positions = [];
        const cx = tx + tw / 2;
        const cy = ty + th / 2;
        const rx = tw / 2 + 70;
        const ry = th / 2 + 60;

        // 玩家框尺寸，用于边界钳制
        const playerW = 130;
        const playerH = 110;
        const margin = 10;

        for (let i = 0; i < count; i++) {
            const angle = (2 * Math.PI * i) / count - Math.PI / 2;
            let px = cx + rx * Math.cos(angle);
            let py = cy + ry * Math.sin(angle);

            // 钳制位置，确保玩家框不超出画布
            px = Math.max(playerW / 2 + margin, Math.min(this.W - playerW / 2 - margin, px));
            py = Math.max(playerH / 2 + margin + 24, Math.min(this.H - playerH / 2 - margin, py));

            positions.push({ x: px, y: py });
        }
        return positions;
    },

    _drawAvatar(ctx, x, y, size, playerIndex, isEliminated, isFolded) {
        const color = this.avatarColors[playerIndex % this.avatarColors.length];
        const alpha = (isEliminated || isFolded) ? 0.4 : 1.0;

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.fillStyle = color;
        ctx.fillRect(x, y, size, size);

        ctx.strokeStyle = isEliminated ? '#5A6A7A' : '#E0F0FF';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, size, size);

        const cx = x + size / 2;
        const cy = y + size / 2;
        const ps = Math.max(2, Math.floor(size / 12));

        // 眼睛
        ctx.fillStyle = '#0B1929';
        ctx.fillRect(cx - ps * 2.5, cy - ps * 1.5, ps * 2, ps * 2);
        ctx.fillRect(cx + ps * 0.5, cy - ps * 1.5, ps * 2, ps * 2);

        // 眼睛高光
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx - ps * 2, cy - ps * 1, ps, ps);
        ctx.fillRect(cx + ps * 1, cy - ps * 1, ps, ps);

        // 嘴巴
        ctx.fillStyle = '#0B1929';
        ctx.fillRect(cx - ps * 1.5, cy + ps * 1, ps * 3, ps);

        // AI标记
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `${Math.floor(size * 0.25)}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('AI', cx, y + size - 3);

        ctx.restore();
    },

    _drawThinkingIndicator(ctx, x, y, totalW, totalH) {
        if (!this._blinkOn) return;

        const dotR = 5;
        const dotX = x + totalW + 8;
        const dotY = y + totalH / 2;

        // 发光效果
        ctx.save();
        ctx.shadowColor = '#00FF88';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#00FF88';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 外环
        ctx.strokeStyle = '#00FF88';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotR + 3, 0, Math.PI * 2);
        ctx.stroke();
    },

    _drawCoin(ctx, cx, cy, r) {
        // 像素风金币
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // 边缘深色
        ctx.strokeStyle = '#B8860B';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // 中心 $ 符号
        ctx.fillStyle = '#B8860B';
        ctx.font = `bold ${Math.round(r * 1.2)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', cx, cy + 0.5);
        ctx.textBaseline = 'alphabetic';
    },

    _drawPlayerChips(ctx, totalBet, pos, tableX, tableY, tableW, tableH) {
        const coinCount = Math.min(Math.floor(totalBet / 50), 20); // 每50画一个，最多20个
        if (coinCount <= 0) return;

        // 计算金币位置：在玩家和牌桌中心之间
        const tableCX = tableX + tableW / 2;
        const tableCY = tableY + tableH / 2;
        const chipX = pos.x + (tableCX - pos.x) * 0.45;
        const chipY = pos.y + (tableCY - pos.y) * 0.45;

        const coinR = 7;
        const stackGap = 3; // 堆叠间距

        // 画金币堆（最多每列5个）
        const cols = Math.ceil(coinCount / 5);
        for (let i = 0; i < coinCount; i++) {
            const col = Math.floor(i / 5);
            const row = i % 5;
            const cx = chipX + (col - (cols - 1) / 2) * (coinR * 2 + 2);
            const cy = chipY - row * stackGap;
            this._drawCoin(ctx, cx, cy, coinR);
        }

        // 金额文字
        ctx.fillStyle = '#FFD700';
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`$${totalBet}`, chipX, chipY + coinR + 12);
    },

    _drawPlayer(ctx, player, pos, isDealer, playerIndex, isThinking, blindTag) {
        const avatarSize = 28;
        const cardScale = 1.07;
        const cardW = CardRenderer.CARD_W * cardScale;
        const cardH = CardRenderer.CARD_H * cardScale;
        const cardGap = 4;

        // 上下布局：上方为头像+名称+筹码，下方为手牌
        const twoCardsW = cardW * 2 + cardGap;
        const infoRowW = avatarSize + 6 + 80; // 头像 + 间距 + 文字区
        const totalW = Math.max(twoCardsW + 8, infoRowW + 8);
        const infoH = avatarSize + 6;
        const totalH = infoH + cardH + 8;

        const x = pos.x - totalW / 2;
        const y = pos.y - totalH / 2;

        // 思考中：发光边框
        if (isThinking) {
            ctx.save();
            ctx.shadowColor = '#00FF88';
            ctx.shadowBlur = this._blinkOn ? 15 : 5;
            ctx.strokeStyle = '#00FF88';
            ctx.lineWidth = 3;
            ctx.strokeRect(x - 2, y - 2, totalW + 4, totalH + 4);
            ctx.restore();
        }

        // 玩家框背景
        const bgColor = player.folded ? '#0B1929' : (player.is_eliminated ? '#0B1929' : '#162D50');
        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, totalW, totalH);

        const borderColor = player.folded ? '#2A4A6B' : (player.is_eliminated ? '#5A6A7A' : '#5B9BD5');
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, totalW, totalH);

        // 头像（左上）
        this._drawAvatar(ctx, x + 4, y + 4, avatarSize, playerIndex, player.is_eliminated, player.folded);

        // 风格色块
        const styleColors = {
            '激进': '#E06060', '保守': '#60C0A0', '均衡': '#87CEEB',
            '诈唬': '#D4A854', '诡计': '#B0D4F1',
        };
        const badgeColor = styleColors[player.style] || '#87CEEB';
        ctx.fillStyle = badgeColor;
        ctx.fillRect(x + avatarSize + 10, y + 4, 6, 6);

        // 名称（头像右侧）
        ctx.fillStyle = player.folded ? '#5A6A7A' : '#E0F0FF';
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.textAlign = 'left';
        const displayName = player.name.length > 5 ? player.name.slice(0, 5) : player.name;
        ctx.fillText(displayName, x + avatarSize + 20, y + 12);

        // 筹码（头像右侧下方）
        ctx.fillStyle = player.is_eliminated ? '#5A6A7A' : '#D4A854';
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.fillText(`$${player.chips}`, x + avatarSize + 10, y + 28);

        // 手牌（下方居中）
        const cardsX = x + (totalW - twoCardsW) / 2;
        const cardsY = y + infoH + 2;

        if (player.hand && player.hand.length === 2 && !player.folded) {
            CardRenderer.drawCard(ctx, player.hand[0], cardsX, cardsY, cardScale);
            CardRenderer.drawCard(ctx, player.hand[1], cardsX + cardW + cardGap, cardsY, cardScale);
        } else if (player.hand && player.hand.length === 2 && player.folded) {
            // 弃牌玩家：显示置灰的手牌
            CardRenderer.drawCardDimmed(ctx, player.hand[0], cardsX, cardsY, cardScale);
            CardRenderer.drawCardDimmed(ctx, player.hand[1], cardsX + cardW + cardGap, cardsY, cardScale);
        } else if (!player.folded && !player.is_eliminated) {
            CardRenderer.drawCardBack(ctx, cardsX, cardsY, cardScale);
            CardRenderer.drawCardBack(ctx, cardsX + cardW + cardGap, cardsY, cardScale);
        }

        // 状态文字（覆盖在手牌区域）
        if (player.is_eliminated) {
            ctx.fillStyle = '#5A6A7A';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('淘汰', x + totalW / 2, cardsY + cardH / 2 + 4);
        } else if (player.folded) {
            ctx.fillStyle = '#5A6A7A';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('弃牌', x + totalW / 2, cardsY + cardH / 2 + 4);
        }

        // 庄家按钮
        if (isDealer && !player.is_eliminated) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(x + totalW - 16, y + 2, 14, 14);
            ctx.fillStyle = '#0B1929';
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('D', x + totalW - 9, y + 12);
        }

        // 大盲/小盲标记（左下角）
        if (blindTag && !player.is_eliminated) {
            const tagW = 22;
            const tagH = 14;
            const tagX = x;
            const tagY = y + totalH - tagH;
            const isSB = blindTag === 'SB';
            ctx.fillStyle = isSB ? '#5BA8D9' : '#E8A838';
            ctx.fillRect(tagX, tagY, tagW, tagH);
            ctx.strokeStyle = isSB ? '#3A7AAA' : '#B87A1A';
            ctx.lineWidth = 1;
            ctx.strokeRect(tagX, tagY, tagW, tagH);
            ctx.fillStyle = '#0B1929';
            ctx.font = '8px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(blindTag, tagX + tagW / 2, tagY + 11);
        }

        // 思考闪烁灯（在玩家框右侧）
        if (isThinking) {
            this._drawThinkingIndicator(ctx, x, y, totalW, totalH);
        }

        // 动作气泡（在玩家框上方，留足间距）
        if (player.last_action && !player.folded) {
            const actionMap = {
                'fold': '弃牌', 'check': '过牌', 'call': '跟注',
                'raise': '加注', 'all_in': '全押', 'bet': '下注',
            };
            const actionCN = actionMap[player.last_action] || player.last_action;
            const bubbleText = player.last_action_amount > 0
                ? `${actionCN} $${player.last_action_amount}`
                : actionCN;

            const bubbleW = Math.max(bubbleText.length * 8 + 16, 70);
            const bubbleH = 20;
            const bubbleX = x + totalW / 2 - bubbleW / 2;
            const bubbleY = y - bubbleH - 6;

            ctx.fillStyle = '#0F2440';
            ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);
            ctx.strokeStyle = '#87CEEB';
            ctx.lineWidth = 1;
            ctx.strokeRect(bubbleX, bubbleY, bubbleW, bubbleH);

            ctx.fillStyle = '#87CEEB';
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(bubbleText, x + totalW / 2, bubbleY + 14);
        }

        ctx.textAlign = 'left';
    },

    _drawCommunityCards(ctx, cards) {
        const totalCount = 5;
        const cardScale = 1.5;
        const cardW = CardRenderer.CARD_W * cardScale;
        const gap = 8;
        const totalW = totalCount * cardW + (totalCount - 1) * gap;
        const startX = this.W / 2 - totalW / 2;
        const startY = this.H / 2 - CardRenderer.CARD_H * cardScale / 2 + 5;

        const revealedCards = cards || [];

        for (let i = 0; i < totalCount; i++) {
            const x = startX + i * (cardW + gap);
            if (i < revealedCards.length) {
                CardRenderer.drawCard(ctx, revealedCards[i], x, startY, cardScale);
            } else {
                CardRenderer.drawCardBack(ctx, x, startY, cardScale);
            }
        }
    },
};
