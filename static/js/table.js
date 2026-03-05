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
    _reasoningBubbles: {},  // { playerId: { text } }

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

        // 全屏像素网格
        this._drawPixelGrid(ctx, 0, 0, this.W, this.H);

        // 牌桌
        const tableW = this.W * 0.6;
        const tableH = this.H * 0.42;
        const tableX = (this.W - tableW) / 2;
        const tableY = (this.H - tableH) / 2;

        ctx.fillStyle = '#1A3A4A';
        ctx.fillRect(tableX, tableY, tableW, tableH);

        // 牌桌像素点阵纹理
        this._drawTableTexture(ctx, tableX, tableY, tableW, tableH);

        ctx.strokeStyle = '#87CEEB';
        ctx.lineWidth = 3;
        ctx.strokeRect(tableX, tableY, tableW, tableH);

        // 牌桌内边框（像素风双线边框）
        ctx.strokeStyle = 'rgba(135, 206, 235, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tableX + 6, tableY + 6, tableW - 12, tableH - 12);

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

        // 清除过期气泡
        this._cleanExpiredBubbles();

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

        // 绘制推理气泡（在所有玩家之上，避免被遮挡）
        players.forEach((p, i) => {
            if (i < positions.length && this._reasoningBubbles[p.id]) {
                const bubble = this._reasoningBubbles[p.id];
                this._drawReasoningBubble(ctx, bubble.text, positions[i].x, positions[i].y);
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

        const coinR = 9;
        const stackGap = 4; // 堆叠间距

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
        ctx.font = '12px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`$${totalBet}`, chipX, chipY + coinR + 14);
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
            ctx.fillStyle = '#E06060';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('淘汰', x + totalW / 2, cardsY + cardH / 2 + 4);
        } else if (player.folded) {
            ctx.fillStyle = '#B0C4D8';
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

    // 设置玩家推理气泡（每个玩家保留自己的气泡，直到该玩家下次思考时才清除）
    setReasoning(playerId, text) {
        if (!text) return;
        const trimmed = text.length > 80 ? text.slice(0, 78) + '…' : text;
        this._reasoningBubbles[playerId] = { text: trimmed };
        this._render();
    },

    // 清除指定玩家的气泡（在该玩家开始新一轮思考时调用）
    clearPlayerBubble(playerId) {
        delete this._reasoningBubbles[playerId];
    },

    // 清除所有气泡（在新一手牌开始时调用）
    clearReasoningBubbles() {
        this._reasoningBubbles = {};
    },

    // 清除过期气泡（保留兼容）
    _cleanExpiredBubbles() {
    },

    // 绘制推理气泡（自动换行，大小自适应，智能方向）
    _drawReasoningBubble(ctx, text, centerX, centerY) {
        ctx.save();

        const fontSize = 13;
        const lineHeight = 18;
        const padding = 10;
        const maxLineWidth = 220;
        const tailH = 8;

        ctx.font = `${fontSize}px "Zpix", monospace`;

        // 自动换行
        const lines = [];
        let currentLine = '';
        for (let i = 0; i < text.length; i++) {
            const testLine = currentLine + text[i];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxLineWidth && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = text[i];
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);

        // 计算气泡尺寸
        let bubbleContentW = 0;
        for (const line of lines) {
            const w = ctx.measureText(line).width;
            if (w > bubbleContentW) bubbleContentW = w;
        }
        const bubbleW = Math.max(bubbleContentW + padding * 2, 80);
        const bubbleH = lines.length * lineHeight + padding * 2;

        // 玩家框大致尺寸（用于偏移，包含动作气泡）
        const playerBoxH = 120;  // 玩家框~90 + 动作气泡~26 + 间距
        const playerBoxW = 130;

        // 气泡放到远离牌桌中心的方向（避免覆盖筹码）
        // 上半部分玩家 → 气泡放上方；下半部分玩家 → 气泡放下方
        let bubbleX, bubbleY, tailDir;
        if (centerY < this.H / 2) {
            // 玩家在上半部分，气泡放上方（远离牌桌中心，额外避开动作气泡）
            bubbleY = centerY - playerBoxH / 2 - bubbleH - tailH - 30;
            tailDir = 'down';
        } else {
            // 玩家在下半部分，气泡放下方（远离牌桌中心）
            bubbleY = centerY + playerBoxH / 2 + tailH + 8;
            tailDir = 'up';
        }
        bubbleX = centerX - bubbleW / 2;

        // 边界钳制
        const clampedX = Math.max(4, Math.min(this.W - bubbleW - 4, bubbleX));
        const clampedY = Math.max(4, Math.min(this.H - bubbleH - 4, bubbleY));

        // 半透明背景（更深更明显）
        ctx.fillStyle = 'rgba(10, 25, 50, 0.95)';
        ctx.fillRect(clampedX, clampedY, bubbleW, bubbleH);

        // 像素风边框（更亮）
        ctx.strokeStyle = 'rgba(135, 206, 235, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(clampedX, clampedY, bubbleW, bubbleH);

        // 尾巴（像素方块三角）
        const tailX = Math.max(clampedX + 10, Math.min(clampedX + bubbleW - 18, centerX - 4));
        if (tailDir === 'down') {
            // 尾巴朝下（气泡在上方）
            const ty = clampedY + bubbleH;
            ctx.fillStyle = 'rgba(10, 25, 50, 0.95)';
            ctx.fillRect(tailX, ty, 8, 4);
            ctx.fillRect(tailX + 2, ty + 4, 4, 4);
            // 尾巴边框
            ctx.fillStyle = 'rgba(135, 206, 235, 0.8)';
            ctx.fillRect(tailX - 1, ty, 1, 4);
            ctx.fillRect(tailX + 8, ty, 1, 4);
            ctx.fillRect(tailX + 1, ty + 4, 1, 4);
            ctx.fillRect(tailX + 6, ty + 4, 1, 4);
            ctx.fillRect(tailX + 2, ty + 8, 4, 1);
        } else {
            // 尾巴朝上（气泡在下方）
            const ty = clampedY;
            ctx.fillStyle = 'rgba(10, 25, 50, 0.95)';
            ctx.fillRect(tailX + 2, ty - 8, 4, 4);
            ctx.fillRect(tailX, ty - 4, 8, 4);
            // 尾巴边框
            ctx.fillStyle = 'rgba(135, 206, 235, 0.8)';
            ctx.fillRect(tailX + 2, ty - 9, 4, 1);
            ctx.fillRect(tailX + 1, ty - 8, 1, 4);
            ctx.fillRect(tailX + 6, ty - 8, 1, 4);
            ctx.fillRect(tailX - 1, ty - 4, 1, 4);
            ctx.fillRect(tailX + 8, ty - 4, 1, 4);
        }

        // 左侧金色装饰线
        ctx.fillStyle = 'rgba(212, 168, 84, 0.6)';
        ctx.fillRect(clampedX, clampedY, 3, bubbleH);

        // 💭 标识（右上角）
        ctx.fillStyle = 'rgba(135, 206, 235, 0.4)';
        ctx.font = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('💭', clampedX + bubbleW - 4, clampedY + 14);

        // 文字内容
        ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
        ctx.font = `${fontSize}px "Zpix", monospace`;
        ctx.textAlign = 'left';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], clampedX + padding, clampedY + padding + (i + 1) * lineHeight - 3);
        }

        ctx.restore();
    },

    // 全屏像素网格背景
    _drawPixelGrid(ctx, x, y, w, h) {
        ctx.save();
        const gridSize = 48;

        // 大网格线
        ctx.strokeStyle = 'rgba(42, 74, 107, 0.25)';
        ctx.lineWidth = 1;
        for (let gx = x; gx <= x + w; gx += gridSize) {
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.lineTo(gx, y + h);
            ctx.stroke();
        }
        for (let gy = y; gy <= y + h; gy += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, gy);
            ctx.lineTo(x + w, gy);
            ctx.stroke();
        }

        // 散布像素亮点
        ctx.fillStyle = 'rgba(135, 206, 235, 0.12)';
        const seed = [
            0.08, 0.15, 0.23, 0.31, 0.42, 0.55, 0.63, 0.72, 0.81, 0.93,
            0.12, 0.28, 0.37, 0.48, 0.67, 0.78, 0.85, 0.05, 0.52, 0.95,
        ];
        for (let i = 0; i < seed.length; i++) {
            const px = x + seed[i] * w;
            const py = y + seed[(i + 7) % seed.length] * h;
            const s = (i % 3 === 0) ? 3 : 2;
            ctx.fillRect(Math.floor(px), Math.floor(py), s, s);
        }

        // CRT 扫描线
        ctx.fillStyle = 'rgba(135, 206, 235, 0.02)';
        for (let sy = y; sy < y + h; sy += 3) {
            ctx.fillRect(x, sy, w, 1);
        }

        ctx.restore();
    },

    // 牌桌面像素点阵纹理
    _drawTableTexture(ctx, tx, ty, tw, th) {
        ctx.save();

        // 点阵纹理
        const dotSpacing = 8;
        ctx.fillStyle = 'rgba(135, 206, 235, 0.06)';
        for (let dx = tx + dotSpacing; dx < tx + tw; dx += dotSpacing) {
            for (let dy = ty + dotSpacing; dy < ty + th; dy += dotSpacing) {
                ctx.fillRect(dx, dy, 1, 1);
            }
        }

        // 四角像素装饰
        const cornerSize = 12;
        const cornerPixel = 3;
        ctx.fillStyle = 'rgba(135, 206, 235, 0.3)';
        // 左上
        for (let i = 0; i < cornerSize; i += cornerPixel) {
            ctx.fillRect(tx + 3 + i, ty + 3, cornerPixel - 1, cornerPixel - 1);
            ctx.fillRect(tx + 3, ty + 3 + i, cornerPixel - 1, cornerPixel - 1);
        }
        // 右上
        for (let i = 0; i < cornerSize; i += cornerPixel) {
            ctx.fillRect(tx + tw - 3 - cornerPixel - i, ty + 3, cornerPixel - 1, cornerPixel - 1);
            ctx.fillRect(tx + tw - 3 - cornerPixel, ty + 3 + i, cornerPixel - 1, cornerPixel - 1);
        }
        // 左下
        for (let i = 0; i < cornerSize; i += cornerPixel) {
            ctx.fillRect(tx + 3 + i, ty + th - 3 - cornerPixel, cornerPixel - 1, cornerPixel - 1);
            ctx.fillRect(tx + 3, ty + th - 3 - cornerPixel - i, cornerPixel - 1, cornerPixel - 1);
        }
        // 右下
        for (let i = 0; i < cornerSize; i += cornerPixel) {
            ctx.fillRect(tx + tw - 3 - cornerPixel - i, ty + th - 3 - cornerPixel, cornerPixel - 1, cornerPixel - 1);
            ctx.fillRect(tx + tw - 3 - cornerPixel, ty + th - 3 - cornerPixel - i, cornerPixel - 1, cornerPixel - 1);
        }

        ctx.restore();
    },
};
