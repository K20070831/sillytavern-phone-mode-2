(async function () {
    await new Promise(r => setTimeout(r, 1000));

    const SAVE_LIMIT = 60;
    const CONTEXT_LIMIT = 20;
    const BIDIRECTIONAL_LIMIT = 20;
    const MAX_BIDIRECTIONAL = 5;
    const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY';
    const VOICE_MAX_SEC = 60;
    const MODEL_VISIBLE_ROWS = 4;
    const POPOVER_SUPPORTED = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || { preset: 'default', customRight: '', customLeft: '', borderColor: '', layout: 'standard' };
    let __pmModelList = [];

    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;
    let isSelectMode = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 主题预设 ──
    const THEME_PRESETS = {
        default:  { right: '#007aff', left: '#e9e9eb', rightText: '#fff', leftText: '#000', label: '默认蓝' },
        pink:     { right: '#ff6b8a', left: '#fce4ec', rightText: '#fff', leftText: '#4a2030', label: '樱花粉' },
        dark:     { right: '#5856d6', left: '#2c2c2e', rightText: '#fff', leftText: '#e0e0e0', label: '暗夜紫' },
        frost:    { right: 'rgba(0,122,255,0.55)', left: 'rgba(255,255,255,0.35)', rightText: '#fff', leftText: '#222', label: '磨砂玻璃', frost: true },
        mint:     { right: '#34c759', left: '#e8f5e9', rightText: '#fff', leftText: '#1b4332', label: '薄荷绿' },
    };

    function contrastText(bg) {
        if (!bg || bg.startsWith('rgba')) return '#fff';
        const c = bg.replace('#','');
        if (c.length !== 6) return '#000';
        const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
        return (r*0.299 + g*0.587 + b*0.114) > 150 ? '#000' : '#fff';
    }

    function loadTheme() {
        try { window.__pmTheme = { ...window.__pmTheme, ...JSON.parse(localStorage.getItem('ST_SMS_THEME')) }; } catch {}
    }
    function saveTheme() {
        try { localStorage.setItem('ST_SMS_THEME', JSON.stringify(window.__pmTheme)); } catch {}
    }
    function applyTheme() {
        const el = phoneWindow;
        if (!el) return;
        const t = window.__pmTheme;
        const p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
        const rBg = t.customRight || p.right;
        const lBg = t.customLeft || p.left;
        const rTxt = t.customRight ? contrastText(t.customRight) : p.rightText;
        const lTxt = t.customLeft ? contrastText(t.customLeft) : p.leftText;
        const border = t.borderColor || '#1a1a1a';
        el.style.setProperty('--pm-r-bg', rBg);
        el.style.setProperty('--pm-l-bg', lBg);
        el.style.setProperty('--pm-r-txt', rTxt);
        el.style.setProperty('--pm-l-txt', lTxt);
        el.style.setProperty('--pm-border', border);
        el.style.setProperty('--pm-frost', p.frost ? '1' : '0');
    }

    // ── 特殊格式关键词 ──
    const SPECIAL_KEYWORDS = {
        '转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账',
        '图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片',
        '语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音',
    };
    const KW_PATTERN = Object.keys(SPECIAL_KEYWORDS).join('|');
    const SPECIAL_RE = new RegExp(`[\\(（]\\s*(${KW_PATTERN})\\s*[+：:\\s]*([^)）]+)[\\)）]`, 'gi');
    function normalizeKeyword(k) { return SPECIAL_KEYWORDS[k] || SPECIAL_KEYWORDS[k.toLowerCase()] || k; }

    // ── 存储 ID ──
    function getStorageId() {
        const c = getCtx();
        if (!c) return 'sms_unknown__default';
        const char = c.characters?.[c.characterId];
        const avatar = char?.avatar || `idx_${c.characterId}`;
        const chatFile = c.chatId || (typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : null) || c.chat_metadata?.chat_id_hash || c.chat_file || 'default';
        return `sms_${avatar}__${chatFile}`;
    }

    // ── 迁移 ──
    function migrateOldHistory() {
        if (localStorage.getItem('ST_SMS_MIGRATED_V3')) return;
        const c = getCtx(); if (!c) return;
        try {
            const oldData = window.__pmHistories || {};
            const newData = {}; let migrated = 0;
            for (const oldKey of Object.keys(oldData)) {
                if (oldKey.startsWith('sms_')) { newData[oldKey] = oldData[oldKey]; continue; }
                const m = oldKey.match(/^(\d+)_(.+)$/);
                if (!m) { newData[oldKey] = oldData[oldKey]; continue; }
                const ch = c.characters?.[parseInt(m[1])];
                if (ch?.avatar) { newData[`sms_${ch.avatar}__${m[2]}`] = oldData[oldKey]; migrated++; }
                else newData[oldKey] = oldData[oldKey];
            }
            window.__pmHistories = newData;
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(newData));
            localStorage.setItem('ST_SMS_MIGRATED_V3', '1');
            if (migrated) console.log(`[phone-mode] 迁移 ${migrated} 条`);
        } catch (e) { console.warn('[phone-mode] 迁移失败', e); }
    }

    function normalizeApiUrls(input) {
        let url = (input || '').trim().replace(/\/+$/, '');
        if (!url) return { chatUrl: '', modelsUrl: '' };
        if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, '/models') };
        if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, '/chat/completions'), modelsUrl: url };
        if (/\/v\d+$/i.test(url)) return { chatUrl: url + '/chat/completions', modelsUrl: url + '/models' };
        return { chatUrl: url + '/v1/chat/completions', modelsUrl: url + '/v1/models' };
    }

    // ── 档案 ──
    function loadProfiles() { try { window.__pmProfiles = JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES')) || []; } catch { window.__pmProfiles = []; } }
    function saveProfiles() { try { localStorage.setItem('ST_SMS_API_PROFILES', JSON.stringify(window.__pmProfiles)); } catch {} }
    function addOrUpdateProfile(p) {
        if (!p.apiUrl || !p.apiKey) return;
        const idx = window.__pmProfiles.findIndex(x => x.apiUrl === p.apiUrl && x.apiKey === p.apiKey);
        if (idx >= 0) window.__pmProfiles[idx] = { ...window.__pmProfiles[idx], ...p, savedAt: Date.now() };
        else window.__pmProfiles.push({ ...p, savedAt: Date.now() });
        saveProfiles();
    }
    window.__pmDeleteProfile = (idx) => { window.__pmProfiles.splice(idx, 1); saveProfiles(); window.__pmShowConfig(); };
    window.__pmPickProfile = (idx) => {
        const p = window.__pmProfiles[idx]; if (!p) return;
        const u = document.getElementById('pm-cfg-url'), k = document.getElementById('pm-cfg-key'), m = document.getElementById('pm-cfg-model');
        if (u) u.value = p.apiUrl||''; if (k) k.value = p.apiKey||''; if (m) m.value = p.model||'';
        const s = document.getElementById('pm-api-status');
        if (s) { s.textContent = '✅ 已载入档案'; s.style.color = '#34c759'; }
    };

    // ── 模式切换 ──
    window.__pmSetMode = (v) => {
        window.__pmConfig.useIndependent = !!v;
        try { localStorage.setItem('ST_SMS_CONFIG', JSON.stringify(window.__pmConfig)); } catch {}
        const a = document.getElementById('pm-mode-main'), b = document.getElementById('pm-mode-indep'), t = document.getElementById('pm-mode-tip');
        if (a&&b) { a.classList.toggle('pm-mode-active',!v); b.classList.toggle('pm-mode-active',!!v); }
        if (t) t.textContent = v ? '🔌 当前：独立API' : '🏠 当前：主API';
    };

    // ── 双向记忆 ──
    function loadBidirectional() { try { window.__pmBidirectional = JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL')) || {}; } catch { window.__pmBidirectional = {}; } }
    function saveBidirectional() { try { localStorage.setItem('ST_SMS_BIDIRECTIONAL', JSON.stringify(window.__pmBidirectional)); } catch {} }

    function applyBidirectionalInjection() {
        const c = getCtx(); if (!c || typeof c.setExtensionPrompt !== 'function') return;
        const id = getStorageId(), checked = window.__pmBidirectional[id] || [], histories = window.__pmHistories[id] || {};
        if (!checked.length) { try { c.setExtensionPrompt(BIDIRECTIONAL_KEY,'',1,4); } catch {} return; }
        const blocks = checked.map(name => {
            const conv = (histories[name]||[]).slice(-BIDIRECTIONAL_LIMIT);
            if (!conv.length) return '';
            const lines = conv.map(m => { const t = (m.content||'').replace(/\s*\/\s*/g,'。'); return m.role==='user' ? `用户：${t}` : `${name}：${t}`; }).join('\n');
            return `【与 ${name} 的最近短信 — 仅 ${name} 与用户本人知晓】\n${lines}`;
        }).filter(Boolean).join('\n\n');
        if (!blocks) { try { c.setExtensionPrompt(BIDIRECTIONAL_KEY,'',1,4); } catch {} return; }
        const prompt = `[手机短信记忆 — 私密信息 · 严格隔离]\n以下是用户与某些角色之间的私人手机短信往来。\n1. 每段短信只属于该角色与用户本人。\n2. 仅当该角色本人在场时才可参考。\n3. 切勿透露给其他角色。\n\n${blocks}\n\n[短信记忆结束]`;
        try { c.setExtensionPrompt(BIDIRECTIONAL_KEY, prompt, 1, 4); } catch (e) { console.warn('[phone-mode] 注入失败', e); }
    }

    window.__pmToggleBidirectional = (name) => {
        const id = getStorageId(), arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
        if (idx >= 0) arr.splice(idx, 1);
        else { if (arr.length >= MAX_BIDIRECTIONAL) { const s = document.querySelector('.pm-bi-tip'); if (s) { s.textContent = `⚠️ 最多 ${MAX_BIDIRECTIONAL} 个`; s.style.color = '#ff3b30'; } return; } arr.push(name); }
        window.__pmBidirectional[id] = arr; saveBidirectional(); applyBidirectionalInjection(); window.__pmShowList();
    };

    // ── 上下文收集 ──
    async function gatherContext() {
        const c = getCtx(), char = c?.characters?.[c.characterId] || {};
        const cleanMsg = (s) => (s||'').replace(/```[\s\S]*?```/g,'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<[^>]+>/g,'').trim();
        const mainChatArr = (c?.chat||[]).slice(-8).map(m => ({ who: m.is_user?'用户':(m.name||'角色'), content: cleanMsg(m.mes||'') })).filter(m => m.content);
        const mainChatText = mainChatArr.map(m => `${m.who}：${m.content}`).join('\n');
        let worldBookText = '';
        try {
            if (typeof c?.getWorldInfoPrompt === 'function') {
                const wi = await c.getWorldInfoPrompt((c.chat||[]).map(m=>m.mes||'').slice(-10), 4096, false);
                worldBookText = wi?.worldInfoString || wi?.worldInfoBefore || '';
                if (!worldBookText && wi && typeof wi === 'object') worldBookText = [wi.worldInfoBefore, wi.worldInfoAfter].filter(Boolean).join('\n');
            }
        } catch {}
        return { cardDesc: char.description??'', cardPersonality: char.personality??'', cardScenario: char.scenario??'', cardFirstMes: char.first_mes??'', cardMesExample: char.mes_example??'', mainChatText, worldBookText };
    }

    // ── 拖拽（transform 方案） ──
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startTX = 0, startTY = 0, moved = false;
        const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const getCurrentTranslate = () => {
            const m = (el.style.transform || '').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
            return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
        };
        const onStart = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true; moved = false;
            const coords = getCoord(e);
            startX = coords.x; startY = coords.y;
            const t = getCurrentTranslate(); startTX = t.x; startTY = t.y;
            el.style.transition = 'none';
            if (e.cancelable) e.preventDefault();
        };
        const onMove = (e) => {
            if (!isDragging) return;
            const coords = getCoord(e);
            const dx = coords.x - startX, dy = coords.y - startY;
            if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            moved = true;
            if (e.cancelable) e.preventDefault();
            el.style.setProperty('transform', `translate(${startTX+dx}px, ${startTY+dy}px)`, 'important');
        };
        const onEnd = () => {
            if (!isDragging) return; isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            if (!moved) window.__pmToggleMin();
        };
        handle.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        handle.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    }

    function escapeHtml(s) { return (s||'').replace(/</g,'<').replace(/>/g,'>'); }
    function escapeAttr(s) { return (s||'').replace(/"/g,'"').replace(/</g,'<'); }

    // ── 气泡渲染 ──
    function createBubbles(text, side) {
        const results = [];
        const re = new RegExp(SPECIAL_RE.source, 'gi');
        let last = 0, m;
        const pushPlain = (str) => {
            const plain = str.trim(); if (!plain) return;
            const b = document.createElement('div'); b.className = `pm-bubble pm-${side}`;
            b.innerHTML = escapeHtml(plain).replace(/\n/g,'<br>');
            results.push(b);
        };
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) pushPlain(text.slice(last, m.index));
            const kind = normalizeKeyword(m[1]);
            const b = document.createElement('div'); b.className = `pm-bubble pm-${side} pm-special`;
            if (kind === '转账') {
                const amount = parseFloat(m[2]) || 0;
                b.innerHTML = `<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>转账</b><span>¥${amount.toFixed(2)}</span></div></div>`;
            } else if (kind === '图片') {
                b.innerHTML = `<div class="pm-img-card">🖼️ ${escapeHtml(m[2].trim())}</div>`;
            } else {
                const txt = m[2].trim(), len = [...txt].length;
                const dur = Math.min(VOICE_MAX_SEC, Math.max(1, len*2));
                const width = Math.min(240, Math.max(100, 80+len*5));
                b.innerHTML = `<div class="pm-voice-wrap"><div class="pm-voice-card pm-voice-${side}" style="width:${width}px" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${dur}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(txt)}</div></div>`;
            }
            results.push(b); last = m.index + m[0].length;
        }
        if (last < text.length) pushPlain(text.slice(last));
        if (!results.length) pushPlain(text);
        return results;
    }

    window.__pmToggleVoice = (el) => {
        const txt = el.parentElement?.querySelector('.pm-voice-text');
        if (txt) txt.style.display = txt.style.display === 'none' ? 'block' : 'none';
    };

    // ── 内容清洗（增强版） ──
    function cleanResponse(raw) {
        return (raw ?? '')
            // 思维链标签
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
            .replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi, '')
            // 小剧场标签
            .replace(/<scene>[\s\S]*?<\/scene>/gi, '')
            .replace(/<narration>[\s\S]*?<\/narration>/gi, '')
            .replace(/<action>[\s\S]*?<\/action>/gi, '')
            // 代码块
            .replace(/```[\s\S]*?```/g, '')
            // 状态栏：【...】整行
            .replace(/^.*【[^】]{2,}】.*$/gm, '')
            // 分割线 + 后续状态行
            .replace(/---+[\s\S]*$/g, '')
            // 残留 HTML 标签
            .replace(/<[^>]+>/g, '')
            // 开头角色名前缀
            .replace(/^\s*\S{1,15}[:：]\s*/m, '')
            .trim();
    }

    function splitToSentences(str) {
        return (str || '').split(/\s*\/\s*/).map(s => s.trim()).filter(s => s.length > 0).slice(0, 8);
    }

    // ── API 调用 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });
        const ctxData = await gatherContext();
        const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText } = ctxData;
        const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT).map(m =>
            m.role === 'user' ? `用户：${cleanResponse(m.content)}` : `${currentPersona}：${cleanResponse(m.content)}`
        ).join('\n');
        const contextBlockMain = [
            cardScenario ? `【场景参考】\n${cardScenario}` : '',
            cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
        ].filter(Boolean).join('\n\n');
        const injectedInstruction = `\n[短信模式指令——最高优先级]\n当前角色：${currentPersona}\n以${currentPersona}的身份用手机短信方式回复，保持角色性格。\n${contextBlockMain ? contextBlockMain + '\n\n' : ''}规则：\n- 只输出短信文字，3到8句，每句用 / 分隔\n- 禁止旁白、心理描写、场景描述、角色名前缀\n- 禁止任何标签或格式符号\n- 特殊格式（中文）：(转账+金额) (图片+描述) (语音+内容)\n- 严禁英文格式\n- 偶尔可使用 (语音+内容)\n\n短信对话历史：\n${smsHistoryText}\n\n用户：${userMsg}\n${currentPersona}：`;

        try {
            let raw = '';
            const cfg = window.__pmConfig;
            const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
            if (useIndep) {
                const systemPrompt = [
                    `你正在扮演"${currentPersona}"通过手机短信与用户聊天。`,
                    cardDesc ? `【角色设定】\n${cardDesc}` : '',
                    cardPersonality ? `【性格】\n${cardPersonality}` : '',
                    cardScenario ? `【场景】\n${cardScenario}` : '',
                    cardFirstMes ? `【开场白参考】\n${cardFirstMes}` : '',
                    cardMesExample ? `【对话示例】\n${cardMesExample}` : '',
                    worldBookText ? `【世界书】\n${worldBookText}` : '',
                    mainChatText ? `【主线最近对话】\n${mainChatText}` : '',
                    '', '只输出3到8句短信，每句用 / 分隔。',
                    '特殊格式（必须中文）：(转账+金额) (图片+描述) (语音+内容)。严禁英文格式。',
                    '禁止任何标签格式旁白选项状态栏。',
                ].filter(Boolean).join('\n\n');
                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...conversationHistory.slice(-CONTEXT_LIMIT).map(m => ({ role: m.role, content: cleanResponse(m.content) }))
                ];
                const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
                const resp = await fetch(chatUrl, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages, max_tokens: 300, temperature: 0.85 })
                });
                const json = await resp.json();
                raw = json.choices?.[0]?.message?.content ?? '';
            } else {
                raw = await c.generateQuietPrompt(injectedInstruction, false, false);
            }
            console.log('[phone-mode] raw:', (raw||'').length, JSON.stringify((raw||'').slice(0,200)));
            const clean = cleanResponse(raw);
            let sentences = splitToSentences(clean);
            if (!sentences.length && raw?.trim()) sentences = splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<[^>]+>/g,''));
            if (!sentences.length) {
                const mode = useIndep ? '独立API' : '主API';
                sentences = !raw?.trim() ? [`（${mode} 空响应）`] : [`（${mode} 格式无法解析）`];
            }
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
            applyBidirectionalInjection();
            return sentences;
        } catch (e) { console.error('[phone-mode]', e); return [`（错误：${e?.message||e}）`]; }
    }

    // ── 气泡操作 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        createBubbles(text, side).forEach(b => { b.dataset.side = side; b.dataset.text = text; list.appendChild(b); });
        list.scrollTop = list.scrollHeight;
    }
    function addNote(text) {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const n = document.createElement('div'); n.className = 'pm-note'; n.textContent = text;
        list.appendChild(n); list.scrollTop = list.scrollHeight;
    }
    function showTyping() {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const t = document.createElement('div'); t.id = 'pm-typing'; t.className = 'pm-bubble pm-left pm-typing-bubble';
        t.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(t); list.scrollTop = list.scrollHeight;
    }
    function hideTyping() { document.getElementById('pm-typing')?.remove(); }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim(); if (!val) return; input.value = '';
        const protect = val.replace(/[\(（][^)）]+[\)\）]/g, m => m.replace(/\//g, '\u0001'));
        protect.split(/[/／]/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean)
            .forEach(chunk => addBubble(chunk, 'right'));
        isGenerating = true; input.disabled = true;
        const btn = phoneWindow.querySelector('.pm-up-btn'); if (btn) btn.disabled = true;
        showTyping();
        const sentences = await fetchSMS(val);
        hideTyping();
        for (const s of sentences) { await new Promise(r => setTimeout(r, 150)); addBubble(s, 'left'); }
        isGenerating = false; input.disabled = false; if (btn) btn.disabled = false; input.focus();
    };

    // ── 删除模式 ──
    window.__pmToggleSelect = () => {
        isSelectMode = !isSelectMode;
        const list = phoneWindow?.querySelector('.pm-msg-list');
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (!list) return;
        if (isSelectMode) {
            trashBtn.style.color = '#ff3b30'; confirmBar.style.display = 'flex';
            list.querySelectorAll('.pm-bubble').forEach(b => {
                if (b.id === 'pm-typing') return;
                const wrap = document.createElement('div'); wrap.className = 'pm-select-wrap';
                // 使用自定义勾选框避免美化隐藏
                const cb = document.createElement('div'); cb.className = 'pm-custom-check'; cb.dataset.checked = '0';
                cb.onclick = () => { cb.dataset.checked = cb.dataset.checked === '0' ? '1' : '0'; };
                b.parentNode.insertBefore(wrap, b);
                wrap.appendChild(cb); wrap.appendChild(b);
                wrap.dataset.side = b.dataset.side; wrap.dataset.text = b.dataset.text;
            });
        } else {
            trashBtn.style.color = ''; confirmBar.style.display = 'none';
            list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
                const b = wrap.querySelector('.pm-bubble');
                if (b) wrap.parentNode.insertBefore(b, wrap); wrap.remove();
            });
        }
    };

    window.__pmDeleteSelected = () => {
        const list = phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const toDelete = new Set();
        list.querySelectorAll('.pm-select-wrap').forEach(wrap => {
            const cb = wrap.querySelector('.pm-custom-check');
            if (cb?.dataset.checked === '1') { toDelete.add(wrap.dataset.text); wrap.remove(); }
            else { const b = wrap.querySelector('.pm-bubble'); if (b) wrap.parentNode.insertBefore(b, wrap); wrap.remove(); }
        });
        if (toDelete.size > 0) {
            conversationHistory = conversationHistory.filter(m => {
                const parts = m.content.split(/\s*\/\s*/);
                return !parts.some(p => toDelete.has(p.trim()));
            });
            const id = getStorageId();
            if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
            window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
            try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
            applyBidirectionalInjection();
        }
        isSelectMode = false;
        const trashBtn = phoneWindow?.querySelector('.pm-trash-btn');
        const confirmBar = phoneWindow?.querySelector('.pm-confirm-bar');
        if (trashBtn) trashBtn.style.color = '';
        if (confirmBar) confirmBar.style.display = 'none';
    };
    // ── 模型选择浮层 ──
    window.__pmShowModelPicker = () => {
        const existing = document.getElementById('pm-model-dropdown');
        if (existing) { existing.remove(); return; }
        if (!__pmModelList.length) {
            const s = document.getElementById('pm-api-status');
            if (s) { s.textContent = '⚠️ 请先拉取模型列表'; s.style.color = '#ff9500'; }
            return;
        }
        const input = document.getElementById('pm-cfg-model');
        const rect = input.getBoundingClientRect();
        const dd = document.createElement('div');
        dd.id = 'pm-model-dropdown'; dd.className = 'pm-model-dropdown';
        if (POPOVER_SUPPORTED) dd.setAttribute('popover','manual');
        dd.innerHTML = `<input class="pm-model-search" placeholder="🔍 搜索模型..." /><div class="pm-model-options"></div>`;
        dd.style.left = rect.left+'px'; dd.style.top = (rect.bottom+4)+'px'; dd.style.width = rect.width+'px';
        document.body.appendChild(dd);
        if (dd.showPopover) try { dd.showPopover(); } catch {}
        const optsDiv = dd.querySelector('.pm-model-options');
        const render = (f='') => {
            const fl = f.toLowerCase();
            const filtered = __pmModelList.filter(m => !fl || m.toLowerCase().includes(fl));
            optsDiv.innerHTML = filtered.length
                ? filtered.map(m => `<div class="pm-model-opt" data-m="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join('')
                : '<div class="pm-model-empty">无匹配</div>';
            optsDiv.querySelectorAll('.pm-model-opt').forEach(el => {
                el.addEventListener('click', () => { document.getElementById('pm-cfg-model').value = el.dataset.m; dd.remove(); });
            });
        };
        render();
        const search = dd.querySelector('.pm-model-search');
        search.addEventListener('input', () => render(search.value)); search.focus();
        setTimeout(() => {
            const closer = (e) => { if (!dd.contains(e.target) && e.target.id !== 'pm-model-arrow') { dd.remove(); document.removeEventListener('click',closer,true); } };
            document.addEventListener('click', closer, true);
        }, 0);
    };

    // ── popover 弹窗工具 ──
    function makeOverlay(html) {
        document.getElementById('pm-overlay')?.remove();
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        if (POPOVER_SUPPORTED) ov.setAttribute('popover','manual');
        ov.innerHTML = html;
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
        if (ov.showPopover) try { ov.showPopover(); } catch {}
        return ov;
    }

    // ── 配置弹窗（含主题 + 布局） ──
    window.__pmShowConfig = () => {
        loadProfiles(); loadTheme();
        const cfg = window.__pmConfig, t = window.__pmTheme;
        const shortUrl = (u) => (u||'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
        const maskKey = (k) => !k ? '' : (k.length<=8 ? '****' : k.slice(0,4)+'****'+k.slice(-4));
        const profilesHtml = window.__pmProfiles.length > 0
            ? window.__pmProfiles.map((p,i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model?' · '+escapeHtml(p.model):''}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i></div>`).join('')
            : '<div class="pm-prof-empty">暂无档案</div>';
        const useIndep = !!cfg.useIndependent;
        const presetBtns = Object.entries(THEME_PRESETS).map(([k,v]) =>
            `<div class="pm-theme-chip ${t.preset===k?'pm-theme-active':''}" data-preset="${k}" onclick="window.__pmSetPreset('${k}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
        ).join('');
        const layoutBtns = ['standard','relaxed'].map(v =>
            `<div class="pm-layout-chip ${t.layout===v?'pm-layout-active':''}" onclick="window.__pmSetLayout('${v}')">${v==='standard'?'标准':'宽松'}</div>`
        ).join('');

        makeOverlay(`
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>设置</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div class="pm-modal-scroll">
    <div style="padding:12px 14px 6px;">
      <div class="pm-cfg-label" style="margin-bottom:6px;">⚡ API 模式</div>
      <div class="pm-mode-switch">
        <div id="pm-mode-main" class="pm-mode-opt ${!useIndep?'pm-mode-active':''}" onclick="window.__pmSetMode(false)">🏠 主API</div>
        <div id="pm-mode-indep" class="pm-mode-opt ${useIndep?'pm-mode-active':''}" onclick="window.__pmSetMode(true)">🔌 独立API</div>
      </div>
      <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndep?'🔌 独立API':'🏠 主API'}</div>
    </div>
    <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label" style="margin:8px 0 6px;">📚 已保存档案</div>
      <div class="pm-prof-list">${profilesHtml}</div>
    </div>
    <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label">API 地址</div>
      <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com 或 .../v1" value="${escapeAttr(cfg.apiUrl||'')}">
      <div class="pm-cfg-label">API Key</div>
      <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${escapeAttr(cfg.apiKey||'')}" maxlength="999">
      <div class="pm-cfg-label">模型名称</div>
      <div class="pm-model-row">
        <input id="pm-cfg-model" class="pm-cfg-input" placeholder="手动输入或点 ▼" value="${escapeAttr(cfg.model||'')}">
        <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">▼</button>
      </div>
      <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">连接成功后自动保存</div>
    </div>
    <div style="padding:10px 16px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label" style="margin-bottom:8px;">🎨 气泡主题</div>
      <div class="pm-theme-row">${presetBtns}</div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
        <label class="pm-cfg-label" style="margin:0;white-space:nowrap;">自定义右</label>
        <input id="pm-custom-right" type="color" value="${t.customRight||'#007aff'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
        <label class="pm-cfg-label" style="margin:0;white-space:nowrap;">自定义左</label>
        <input id="pm-custom-left" type="color" value="${t.customLeft||'#e9e9eb'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
        <button onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
        <label class="pm-cfg-label" style="margin:0;white-space:nowrap;">边框颜色</label>
        <input id="pm-border-color" type="color" value="${t.borderColor||'#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
        <button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button>
      </div>
    </div>
    <div style="padding:10px 16px;border-top:1px solid #f0f0f0;">
      <div class="pm-cfg-label" style="margin-bottom:8px;">📐 界面布局</div>
      <div class="pm-layout-row">${layoutBtns}</div>
    </div>
  </div>
  <div class="pm-modal-add" style="display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;gap:6px;">
      <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🔗 拉取模型</button>
      <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🧪 测试</button>
    </div>
    <button onclick="window.__pmSaveConfig()" style="background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">保存配置</button>
  </div>
</div>`);
    };

    // ── 主题/布局回调 ──
    window.__pmSetPreset = (p) => {
        window.__pmTheme.preset = p;
        window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
        saveTheme(); applyTheme();
        document.querySelectorAll('.pm-theme-chip').forEach(el => el.classList.toggle('pm-theme-active', el.dataset.preset === p));
    };
    window.__pmSetCustomColor = () => {
        window.__pmTheme.customRight = document.getElementById('pm-custom-right')?.value || '';
        window.__pmTheme.customLeft = document.getElementById('pm-custom-left')?.value || '';
        window.__pmTheme.preset = 'custom';
        saveTheme(); applyTheme();
        document.querySelectorAll('.pm-theme-chip').forEach(el => el.classList.remove('pm-theme-active'));
    };
    window.__pmClearCustomColor = () => {
        window.__pmTheme.customRight = ''; window.__pmTheme.customLeft = '';
        window.__pmTheme.preset = 'default';
        saveTheme(); applyTheme();
        window.__pmShowConfig();
    };
    window.__pmSetBorderColor = () => {
        window.__pmTheme.borderColor = document.getElementById('pm-border-color')?.value || '#1a1a1a';
        saveTheme(); applyTheme();
    };
    window.__pmSetLayout = (v) => {
        window.__pmTheme.layout = v; saveTheme();
        if (phoneWindow) phoneWindow.dataset.layout = v;
        document.querySelectorAll('.pm-layout-chip').forEach(el => el.classList.toggle('pm-layout-active', el.textContent === (v==='standard'?'标准':'宽松')));
    };

    // ── API 测试 ──
    window.__pmTestApi = async () => {
        const u=document.getElementById('pm-cfg-url').value.trim(), k=document.getElementById('pm-cfg-key').value.trim(), m=document.getElementById('pm-cfg-model').value.trim();
        const s=document.getElementById('pm-api-status');
        if (!u){s.textContent="❌ 填写API地址";s.style.color="#ff3b30";return;}
        s.textContent="连接中...";s.style.color="#007aff";
        const{modelsUrl}=normalizeApiUrls(u);
        try{
            const r=await fetch(modelsUrl,{method:'GET',headers:{'Authorization':`Bearer ${k}`}});
            if(!r.ok)throw new Error(`HTTP ${r.status}`);
            const d=await r.json();
            if(d?.data&&Array.isArray(d.data)){__pmModelList=d.data.map(x=>x.id).filter(Boolean);s.textContent=`✅ 获取 ${__pmModelList.length} 个模型`;s.style.color="#34c759";}
            else{s.textContent="✅ 连接成功（手动输入模型）";s.style.color="#34c759";}
            addOrUpdateProfile({apiUrl:u,apiKey:k,model:m});
        }catch(e){s.textContent="❌ "+e.message;s.style.color="#ff3b30";}
    };
    window.__pmTestModel = async () => {
        const u=document.getElementById('pm-cfg-url').value.trim(),k=document.getElementById('pm-cfg-key').value.trim(),m=document.getElementById('pm-cfg-model').value.trim();
        const s=document.getElementById('pm-api-status');
        if(!u||!k||!m){s.textContent='❌ 请填完整';s.style.color='#ff3b30';return;}
        s.textContent=`测试「${m}」...`;s.style.color='#007aff';
        const{chatUrl}=normalizeApiUrls(u);const ctrl=new AbortController();const tm=setTimeout(()=>ctrl.abort(),15000);
        try{
            const r=await fetch(chatUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${k}`},body:JSON.stringify({model:m,messages:[{role:'user',content:'hi'}],max_tokens:16}),signal:ctrl.signal});
            clearTimeout(tm);if(!r.ok){const t=await r.text();throw new Error(`HTTP ${r.status}: ${t.slice(0,80)}`);}
            const j=await r.json(),reply=j.choices?.[0]?.message?.content;
            s.textContent=reply!=null?`✅ 可用："${String(reply).slice(0,25)}"`:'⚠️ 格式异常';s.style.color=reply!=null?'#34c759':'#ff9500';
        }catch(e){clearTimeout(tm);s.textContent='❌ '+(e.name==='AbortError'?'超时':e.message);s.style.color='#ff3b30';}
    };
    window.__pmSaveConfig = () => {
        const apiUrl=document.getElementById('pm-cfg-url')?.value.trim()??'',apiKey=document.getElementById('pm-cfg-key')?.value.trim()??'',model=document.getElementById('pm-cfg-model')?.value.trim()??'';
        window.__pmConfig={apiUrl,apiKey,model,useIndependent:!!window.__pmConfig.useIndependent};
        try{localStorage.setItem('ST_SMS_CONFIG',JSON.stringify(window.__pmConfig));}catch{}
        if(apiUrl&&apiKey)addOrUpdateProfile({apiUrl,apiKey,model});
        document.getElementById('pm-overlay')?.remove();
        addNote(`已保存：${window.__pmConfig.useIndependent&&apiUrl?'独立API':'主API'}`);
    };

    // ── 联系人弹窗 ──
    window.__pmShowList = () => {
        const id = getStorageId();
        const list = Object.keys(window.__pmHistories[id] || {});
        const checked = window.__pmBidirectional[id] || [];
        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>联系人</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div class="pm-bi-bar">
    <span>🧠 勾选的角色可被主楼读取短信内容</span>
    <span class="pm-bi-tip">已选 ${checked.length}/${MAX_BIDIRECTIONAL}</span>
  </div>
  <div class="pm-modal-list">
    ${list.length > 0
        ? list.map(n => {
            const isChk = checked.includes(n);
            return `<div class="pm-li">
              <div class="pm-custom-check pm-bi-style ${isChk?'is-checked':''}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${n.replace(/'/g,"\\'")}')"></div>
              <span onclick="window.__pmSwitch('${n.replace(/'/g,"\\'")}')">${escapeHtml(n)}</span>
              <i onclick="window.__pmDel('${n.replace(/'/g,"\\'")}')">删除</i>
            </div>`;
        }).join('')
        : '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>'
    }
  </div>
  <div class="pm-modal-add">
    <input id="pm-add-input" placeholder="输入角色名...">
    <button onclick="window.__pmSwitch(document.getElementById('pm-add-input').value.trim())">聊天</button>
  </div>
</div>`);
        setTimeout(() => {
            document.getElementById('pm-add-input')?.addEventListener('keydown', e => {
                if (e.key === 'Enter') window.__pmSwitch(document.getElementById('pm-add-input').value.trim());
            });
        }, 0);
    };

    window.__pmSwitch = (name) => {
        if (!name?.trim()) return; name = name.trim();
        document.getElementById('pm-overlay')?.remove();
        const id = getStorageId();
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] ?? [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list'); list.innerHTML = '';
            if (conversationHistory.length > 0) {
                addNote(`与 ${name} 的历史记录`);
                conversationHistory.forEach(m => {
                    const protect = m.content.replace(/[\(（][^)）]+[\)\）]/g, mm => mm.replace(/\//g, '\u0001'));
                    protect.split(/\s*\/\s*/).map(s => s.replace(/\u0001/g, '/').trim()).filter(Boolean)
                        .forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
                });
                addNote('── 以上为历史记录 ──');
            } else addNote(`开始与 ${name} 的对话`);
        }
        applyBidirectionalInjection();
    };

    window.__pmDel = (name) => {
        const id = getStorageId();
        if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
        try { localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(window.__pmHistories)); } catch {}
        const arr = window.__pmBidirectional[id] || [];
        const idx = arr.indexOf(name);
        if (idx >= 0) { arr.splice(idx,1); window.__pmBidirectional[id]=arr; saveBidirectional(); }
        applyBidirectionalInjection(); window.__pmShowList();
    };

    window.__pmToggleMin = () => {
        isMinimized = !isMinimized;
        phoneWindow.classList.toggle('is-min', isMinimized);
        phoneWindow.style.removeProperty('transform');
    };
    window.__pmEnd = () => {
        if (phoneWindow) { try { phoneWindow.hidePopover?.(); } catch {} phoneWindow.remove(); }
        phoneWindow = null; phoneActive = false; isMinimized = false; isSelectMode = false;
    };

    function ensureVisibility() {
        if (!phoneWindow) return;
        const cs = getComputedStyle(phoneWindow);
        if (cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity||'1')<0.1) {
            phoneWindow.style.setProperty('display','flex','important');
            phoneWindow.style.setProperty('visibility','visible','important');
            phoneWindow.style.setProperty('opacity','1','important');
        }
    }
    setInterval(ensureVisibility, 2000);

    // ── 打开窗口 ──
    window.__pmOpen = () => {
        if (phoneActive && phoneWindow) {
            try { phoneWindow.showPopover?.(); } catch {}
            phoneWindow.style.display='flex'; ensureVisibility(); return;
        }
        try { window.__pmHistories = JSON.parse(localStorage.getItem('ST_SMS_DATA_V2')) || {}; } catch {}
        try {
            const saved = JSON.parse(localStorage.getItem('ST_SMS_CONFIG'));
            window.__pmConfig = saved || { apiUrl:'',apiKey:'',model:'',useIndependent:false };
            if (typeof window.__pmConfig.useIndependent === 'undefined')
                window.__pmConfig.useIndependent = !!(window.__pmConfig.apiUrl && window.__pmConfig.apiKey);
        } catch { window.__pmConfig = { apiUrl:'',apiKey:'',model:'',useIndependent:false }; }
        loadProfiles(); loadBidirectional(); loadTheme(); migrateOldHistory();

        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? 'AI';

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone';
        phoneWindow.dataset.layout = window.__pmTheme.layout || 'standard';
        if (POPOVER_SUPPORTED) phoneWindow.setAttribute('popover','manual');

        phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn" title="联系人" style="justify-self:start;">☰</button>
    <div class="pm-name">${escapeHtml(defaultChar)}</div>
    <div class="pm-nav-right">
      <button onclick="window.__pmToggleSelect()" class="pm-nav-btn pm-trash-btn" title="删除">🗑</button>
      <button onclick="window.__pmShowConfig()" class="pm-nav-btn" title="设置">⚙</button>
      <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30" title="关闭">✕</button>
    </div>
  </div>
  <div class="pm-confirm-bar" style="display:none;">
    <span class="pm-confirm-tip">选择要删除的消息</span>
    <button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">删除所选</button>
    <button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">取消</button>
  </div>
  <div class="pm-msg-list"></div>
  <div class="pm-input-bar">
    <input class="pm-input" placeholder="iMessage">
    <button onclick="window.__pmSend()" class="pm-up-btn">↑</button>
  </div>
</div>`;

        document.body.appendChild(phoneWindow);
        if (phoneWindow.showPopover) try { phoneWindow.showPopover(); } catch {}
        phoneActive = true;
        phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.__pmSend();}
        });
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        applyTheme();
        window.__pmSwitch(defaultChar);
        applyBidirectionalInjection();
        ensureVisibility();
    };

    // ══════════════════════════════
    //  CSS
    // ══════════════════════════════
    if (!document.getElementById('pm-css')) {
        const s = document.createElement('style');
        s.id = 'pm-css';
        s.textContent = `
[popover]{border:none;padding:0;background:transparent;color:inherit;margin:0;overflow:visible;}
[popover]::backdrop{display:none;background:transparent;}

#pm-iphone {
    --pm-r-bg:#007aff;--pm-l-bg:#e9e9eb;--pm-r-txt:#fff;--pm-l-txt:#000;--pm-border:#1a1a1a;--pm-frost:0;
    position:fixed !important;
    inset:auto 40px 40px auto !important;
    margin:0 !important; transform:none !important;
    width:330px !important;height:580px !important;
    min-width:330px !important;max-width:330px !important;
    min-height:580px !important;max-height:580px !important;
    background:#fff !important;
    border:10px solid var(--pm-border) !important;
    border-radius:45px !important;z-index:2147483647 !important;
    display:flex !important;flex-direction:column !important;
    visibility:visible !important;opacity:1 !important;
    overflow:hidden !important;
    box-shadow:0 20px 60px rgba(0,0,0,.45) !important;
    transition:.35s cubic-bezier(.18,.89,.32,1.2);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif !important;
    touch-action:none;box-sizing:border-box !important;
    pointer-events:auto !important;filter:none !important;color:#000 !important;
}
#pm-iphone.is-min {
    inset:auto 40px 40px auto !important;
    height:50px !important;min-height:50px !important;max-height:50px !important;
    width:140px !important;min-width:140px !important;max-width:140px !important;
    border-radius:25px !important;border-width:6px !important;
}
#pm-iphone.is-min .pm-main-ui{display:none !important;}
#pm-iphone *,#pm-iphone *::before,#pm-iphone *::after{box-sizing:border-box;}
.pm-island{width:100px;height:28px;background:#1a1a1a;margin:8px auto 4px;border-radius:14px;cursor:move;flex-shrink:0;touch-action:none;}
.pm-main-ui{flex:1 !important;display:flex !important;flex-direction:column !important;overflow:hidden;min-height:0;}
.pm-navbar{display:grid !important;grid-template-columns:auto 1fr auto;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f0;flex-shrink:0;}
.pm-name{font-weight:700 !important;color:#000 !important;font-size:15px !important;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px;min-width:0;}
.pm-nav-right{display:flex;gap:4px;justify-content:flex-end;}
/* 🔧 布局：宽松模式 */
#pm-iphone[data-layout="relaxed"] .pm-nav-right{gap:10px;}
#pm-iphone[data-layout="relaxed"] .pm-navbar{padding:8px 14px;}

.pm-nav-btn{background:none !important;border:none !important;font-size:18px !important;cursor:pointer;color:#007aff !important;padding:3px !important;line-height:1;flex-shrink:0;}
.pm-confirm-bar{background:#fff8f0;border-bottom:1px solid #ffe0b0;padding:7px 12px;align-items:center;gap:8px;flex-shrink:0;}
.pm-confirm-tip{flex:1;font-size:12px;color:#888;}
.pm-confirm-btn{background:#ff3b30 !important;color:#fff !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600;font-family:inherit;}
.pm-cancel-btn{background:#f0f0f0 !important;color:#333 !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;}
.pm-msg-list{flex:1 !important;overflow-y:auto !important;padding:12px !important;display:flex !important;flex-direction:column !important;gap:7px;background:#fff !important;min-height:0;}
.pm-select-wrap{display:flex !important;align-items:flex-end;gap:6px;}

/* 🔧 自定义勾选框（不受美化影响） */
.pm-custom-check{width:20px;height:20px;border-radius:50%;border:2px solid #ccc;cursor:pointer;flex-shrink:0;margin-bottom:4px;transition:all .15s;position:relative;background:#fff;}
.pm-custom-check[data-checked="1"],.pm-custom-check.is-checked{border-color:#007aff;background:#007aff;}
.pm-custom-check[data-checked="1"]::after,.pm-custom-check.is-checked::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;}
.pm-bi-style{border-color:#e0a030;}
.pm-bi-style.is-checked{border-color:#ff9500;background:#ff9500;}

.pm-bubble{max-width:74% !important;padding:9px 13px;border-radius:18px !important;font-size:14px !important;line-height:1.45;word-break:break-word;animation:pm-pop .22s ease-out;}
.pm-bubble.pm-special{background:transparent !important;box-shadow:none !important;padding:0 !important;}
@keyframes pm-pop{from{opacity:0;transform:scale(.92) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}

/* 🔧 气泡用 CSS 变量着色 */
.pm-right{align-self:flex-end !important;background:var(--pm-r-bg) !important;color:var(--pm-r-txt) !important;border-bottom-right-radius:4px !important;}
.pm-left{align-self:flex-start !important;background:var(--pm-l-bg) !important;color:var(--pm-l-txt) !important;border-bottom-left-radius:4px !important;}
/* 磨砂玻璃 */
#pm-iphone[style*="--pm-frost: 1"] .pm-right,
#pm-iphone[style*="--pm-frost: 1"] .pm-left{backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);}

.pm-typing-bubble{display:flex !important;gap:5px;align-items:center;padding:11px 15px !important;width:fit-content;}
.pm-typing-bubble span{width:7px;height:7px;border-radius:50%;background:#999;display:inline-block;animation:pm-bounce 1.2s infinite;}
.pm-typing-bubble span:nth-child(2){animation-delay:.2s;}.pm-typing-bubble span:nth-child(3){animation-delay:.4s;}
@keyframes pm-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
.pm-note{text-align:center;font-size:11px;color:#bbb;padding:3px 0;}
.pm-transfer-card{background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;min-width:150px;box-shadow:0 3px 10px rgba(255,149,0,.35);}
.pm-t-icon{width:34px;height:34px;background:rgba(255,255,255,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;}
.pm-t-info{display:flex;flex-direction:column;gap:1px;}.pm-t-info b{font-size:12px;opacity:.85;}.pm-t-info span{font-size:17px;font-weight:700;}
.pm-img-card{background:#f2f2f7;border:1px solid #e0e0e0;padding:12px 14px;border-radius:14px;color:#555;font-size:13px;text-align:center;}

.pm-voice-wrap{display:flex;flex-direction:column;gap:4px;align-items:inherit;}
.pm-special.pm-right .pm-voice-wrap{align-items:flex-end;}.pm-special.pm-left .pm-voice-wrap{align-items:flex-start;}
.pm-voice-card{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;cursor:pointer;user-select:none;transition:filter .15s;}
.pm-voice-card:hover{filter:brightness(.96);}
.pm-voice-right{background:var(--pm-r-bg);color:var(--pm-r-txt);border-bottom-right-radius:4px;flex-direction:row-reverse;}
.pm-voice-left{background:var(--pm-l-bg);color:var(--pm-l-txt);border-bottom-left-radius:4px;}
.pm-voice-icon{font-size:14px;flex-shrink:0;}
.pm-voice-wave{flex:1;display:flex;gap:3px;align-items:center;height:16px;min-width:20px;}
.pm-voice-wave i{display:inline-block;width:3px;background:currentColor;opacity:.7;border-radius:2px;animation:pm-wave 1s infinite ease-in-out;}
.pm-voice-wave i:nth-child(1){height:8px;animation-delay:0s;}.pm-voice-wave i:nth-child(2){height:14px;animation-delay:.2s;}.pm-voice-wave i:nth-child(3){height:10px;animation-delay:.4s;}
@keyframes pm-wave{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1)}}
.pm-voice-dur{font-size:12px;opacity:.85;min-width:34px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;}
.pm-voice-text{background:#f7f7f9;border:1px solid #e5e5e8;color:#333;padding:7px 10px;border-radius:10px;font-size:13px;line-height:1.4;max-width:220px;word-break:break-word;position:relative;}
.pm-voice-text::before{content:'已转文字';position:absolute;top:-8px;left:8px;font-size:9px;color:#999;background:#fff;padding:0 4px;border-radius:4px;}

.pm-input-bar{padding:8px 12px 30px !important;display:flex !important;gap:8px;border-top:1px solid #f0f0f0;align-items:center;background:#fff !important;flex-shrink:0;}
.pm-input{flex:1 !important;min-width:0 !important;background:#f2f2f7 !important;color:#000 !important;border:none !important;border-radius:20px !important;padding:9px 14px !important;outline:none !important;font-size:14px !important;font-family:inherit !important;}
.pm-input:disabled{opacity:.5;}
.pm-up-btn{width:32px !important;height:32px !important;background:#007aff !important;color:#fff !important;border:none !important;border-radius:50% !important;cursor:pointer;font-size:16px !important;font-weight:bold;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0;}
.pm-up-btn:disabled{background:#ccc !important;}

#pm-overlay{position:fixed !important;inset:0 !important;margin:0 !important;width:100vw !important;height:100vh !important;height:100dvh !important;max-width:none !important;max-height:none !important;background:rgba(0,0,0,.45) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;border:none !important;padding:0 !important;}
.pm-modal{background:#fff !important;border-radius:20px !important;width:290px;max-height:85vh;max-height:85dvh;display:flex !important;flex-direction:column !important;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.28);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif !important;}
.pm-modal-wide{width:320px;}
.pm-modal-scroll{flex:1;overflow-y:auto;min-height:0;}
.pm-modal-header{display:flex !important;justify-content:space-between !important;align-items:center !important;padding:16px 18px 12px !important;border-bottom:1px solid #f0f0f0;flex-shrink:0;}
.pm-modal-header b{font-size:16px !important;color:#000 !important;}
.pm-modal-close{font-size:20px;color:#999;cursor:pointer;line-height:1;}
.pm-bi-bar{padding:8px 14px;background:#fff8e8;border-bottom:1px solid #ffe6a8;font-size:11px;color:#885d00;display:flex;flex-direction:column;gap:3px;}
.pm-bi-tip{font-weight:600;color:#b87a00;}
.pm-modal-list{overflow-y:auto;flex:1;padding:6px 8px;max-height:400px;}
.pm-li{display:flex !important;align-items:center !important;gap:10px;padding:10px;border-radius:12px;}
.pm-li:hover{background:#f5f5f5;}
.pm-li span{flex:1;font-size:14px !important;color:#007aff !important;font-weight:500;cursor:pointer;}
.pm-li i{font-style:normal;font-size:11px;color:#fff !important;background:#ff3b30 !important;padding:3px 9px;border-radius:8px;cursor:pointer;font-weight:600;flex-shrink:0;}
.pm-modal-add{padding:12px 14px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;flex-shrink:0;}
.pm-modal-add input{flex:1;min-width:0;border:1px solid #ddd;border-radius:10px;padding:9px 12px;font-size:13px;outline:none;font-family:inherit;color:#000 !important;background:#fff !important;}
.pm-modal-add button{background:#007aff !important;color:#fff !important;border:none;border-radius:10px;padding:9px 14px;font-size:13px;cursor:pointer;font-weight:600;white-space:nowrap;font-family:inherit;}
.pm-cfg-label{font-size:12px;color:#888;margin-bottom:-4px;}
.pm-cfg-input{width:100%;border:1px solid #ddd !important;border-radius:10px !important;padding:9px 12px;font-size:13px !important;outline:none;font-family:inherit;color:#000 !important;background:#fff !important;}
.pm-cfg-tip{font-size:11px;color:#aaa;text-align:center;padding:4px 0;}
.pm-mode-switch{display:flex !important;background:#f0f0f3;border-radius:12px;padding:3px;gap:3px;}
.pm-mode-opt{flex:1;text-align:center;padding:9px 0;font-size:13px;font-weight:600;color:#888;cursor:pointer;border-radius:9px;transition:all .2s;user-select:none;}
.pm-mode-opt:hover{color:#555;}
.pm-mode-active{background:#fff !important;color:#007aff !important;box-shadow:0 2px 6px rgba(0,0,0,.08);}
.pm-prof-list{max-height:100px;overflow-y:auto;border:1px solid #eee;border-radius:10px;background:#fafafa;padding:4px;}
.pm-prof-li{display:flex !important;align-items:center !important;gap:8px;padding:7px 9px;border-radius:8px;transition:background .15s;}
.pm-prof-li:hover{background:#fff;}
.pm-prof-info{flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;gap:2px;}
.pm-prof-url{font-size:12px;color:#007aff !important;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-meta{font-size:10px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-del{font-style:normal;font-size:12px;color:#ff3b30;background:#fff !important;border:1px solid #ffd0cc;width:22px;height:22px;border-radius:50%;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer;flex-shrink:0;font-weight:600;}
.pm-prof-del:hover{background:#ff3b30 !important;color:#fff !important;border-color:#ff3b30;}
.pm-prof-empty{text-align:center;color:#aaa;font-size:12px;padding:10px 0;}

/* 主题选择器 */
.pm-theme-row{display:flex;gap:6px;flex-wrap:wrap;}
.pm-theme-chip{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-theme-chip:hover{background:#eee;}
.pm-theme-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}
.pm-theme-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;}
.pm-color-pick{width:32px;height:28px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;background:none;}
.pm-color-clear{background:none;border:1px solid #ddd;border-radius:6px;padding:3px 8px;font-size:11px;color:#888;cursor:pointer;white-space:nowrap;}
.pm-color-clear:hover{background:#f0f0f0;}

/* 布局选择器 */
.pm-layout-row{display:flex;gap:6px;}
.pm-layout-chip{padding:6px 16px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-layout-chip:hover{background:#eee;}
.pm-layout-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}

.pm-model-row{display:flex;gap:6px;}.pm-model-row .pm-cfg-input{flex:1;}
#pm-model-arrow{background:#f0f0f3;border:1px solid #ddd;border-radius:10px;width:38px;cursor:pointer;font-size:12px;color:#555;flex-shrink:0;transition:all .15s;}
#pm-model-arrow:hover{background:#007aff;color:#fff;border-color:#007aff;}
.pm-model-dropdown{position:fixed;z-index:2147483647;background:#fff !important;border:1px solid #ddd !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;display:flex;flex-direction:column;min-width:200px;padding:0 !important;margin:0 !important;color:#000 !important;}
.pm-model-search{border:none !important;border-bottom:1px solid #eee !important;padding:9px 12px !important;outline:none;font-size:13px !important;background:#fafafa !important;color:#000 !important;width:100%;font-family:inherit;}
.pm-model-options{overflow-y:auto;max-height:${MODEL_VISIBLE_ROWS*34}px;}
.pm-model-opt{padding:8px 12px;font-size:13px;color:#333;cursor:pointer;border-bottom:1px solid #f5f5f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:34px;line-height:18px;}
.pm-model-opt:hover{background:#f0f7ff;color:#007aff;}
.pm-model-empty{padding:14px;text-align:center;font-size:12px;color:#999;}

/* 手机端响应式 */
@media(max-width:500px),(max-height:700px){
    #pm-iphone{
        inset:0 !important;margin:auto !important;transform:none !important;
        width:min(330px,92vw) !important;height:min(560px,82vh) !important;height:min(560px,82dvh) !important;
        min-width:0 !important;min-height:0 !important;max-width:92vw !important;max-height:82vh !important;max-height:82dvh !important;
        border-width:8px !important;border-radius:36px !important;
    }
    #pm-iphone.is-min{
        inset:auto 20px 20px auto !important;margin:0 !important;transform:none !important;
        width:120px !important;min-width:120px !important;max-width:120px !important;
        height:44px !important;min-height:44px !important;max-height:44px !important;
        border-width:5px !important;border-radius:22px !important;
    }
    .pm-modal,.pm-modal-wide{width:min(320px,94vw) !important;max-height:90vh !important;max-height:90dvh !important;}
}
        `;
        document.head.appendChild(s);
    }

    // ── 注册 /phone ──
    function registerPhoneCommand() {
        const ctx = getCtx(); if (!ctx) return false;
        const cb = () => { try { window.__pmOpen(); } catch(e) { console.error('[phone-mode]',e); } return ''; };
        try {
            const SCP=window.SlashCommandParser||ctx.SlashCommandParser, SC=window.SlashCommand||ctx.SlashCommand;
            if (SCP&&SC&&typeof SCP.addCommandObject==='function'&&typeof SC.fromProps==='function') {
                SCP.addCommandObject(SC.fromProps({name:'phone',callback:cb,helpString:'打开短信'}));
                return true;
            }
        } catch {}
        try { if (typeof ctx.registerSlashCommand==='function') { ctx.registerSlashCommand('phone',cb,[],'打开短信',true,true); return true; } } catch {}
        return false;
    }
    if (!registerPhoneCommand()) { let t=0; const i=setInterval(()=>{t++;if(registerPhoneCommand()||t>=30)clearInterval(i);},500); }

    document.addEventListener('keydown',e=>{
        if(e.key!=='Enter'||e.shiftKey)return;
        const ta=document.getElementById('send_textarea');
        if(!ta||document.activeElement!==ta)return;
        if(ta.value.trim()==='/phone'){e.preventDefault();e.stopImmediatePropagation();ta.value='';window.__pmOpen();}
    },true);
    document.addEventListener('click',e=>{
        const btn=e.target.closest&&e.target.closest('#send_but');if(!btn)return;
        const ta=document.getElementById('send_textarea');if(!ta)return;
        if(ta.value.trim()==='/phone'){e.preventDefault();e.stopImmediatePropagation();ta.value='';window.__pmOpen();}
    },true);

    try{window.__pmHistories=JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'))||{};}catch{}
    loadBidirectional();
    setTimeout(()=>{migrateOldHistory();applyBidirectionalInjection();},1500);

    console.log('[phone-mode] v4.0 loaded — theme+layout+enhanced-clean');
})();
