(async function () {
    await new Promise(r => setTimeout(r, 1000));

    const SAVE_LIMIT = 60, CONTEXT_LIMIT = 20, BIDIRECTIONAL_LIMIT = 20, MAX_BIDIRECTIONAL = 5;
    const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY', VOICE_MAX_SEC = 60, MODEL_VISIBLE_ROWS = 4;
    const MAX_GROUP_MEMBERS = 6;
    const POPOVER_SUPPORTED = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
    const GROUP_COLORS = [
        { bg:'#e9e9eb', text:'#000' }, { bg:'#b8e6c8', text:'#1b4332' },
        { bg:'#f5d0d0', text:'#4a2030' }, { bg:'#d4d0f5', text:'#2d2252' },
        { bg:'#f5e6b8', text:'#4a3a10' },
    ];

    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl:'',apiKey:'',model:'',useIndependent:false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || { preset:'default',customRight:'',customLeft:'',borderColor:'',layout:'standard' };
    window.__pmBgGlobal = window.__pmBgGlobal || '';
    window.__pmBgLocal = window.__pmBgLocal || {};
    window.__pmGroups = window.__pmGroups || {}; // {storageId: {displayName: {name, members}}}
    let __pmModelList = [];

    let phoneActive=false, phoneWindow=null, currentPersona='', conversationHistory=[];
    let isGenerating=false, isMinimized=false, isSelectMode=false;
    let isGroupChat=false, groupMembers=[], groupColorMap={}, groupDisplayName='';

    const getCtx = () => typeof SillyTavern!=='undefined' ? SillyTavern.getContext() : null;

    const THEME_PRESETS = {
        default:{right:'#007aff',left:'#e9e9eb',rightText:'#fff',leftText:'#000',label:'默认蓝'},
        pink:{right:'#ff6b8a',left:'#fce4ec',rightText:'#fff',leftText:'#4a2030',label:'樱花粉'},
        dark:{right:'#5856d6',left:'#2c2c2e',rightText:'#fff',leftText:'#e0e0e0',label:'暗夜紫'},
        frost:{right:'rgba(0,122,255,0.55)',left:'rgba(255,255,255,0.35)',rightText:'#fff',leftText:'#222',label:'磨砂玻璃',frost:true},
        mint:{right:'#34c759',left:'#e8f5e9',rightText:'#fff',leftText:'#1b4332',label:'薄荷绿'},
    };

    function contrastText(bg){if(!bg||bg.startsWith('rgba'))return'#fff';const c=bg.replace('#','');if(c.length!==6)return'#000';const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);return(r*.299+g*.587+b*.114)>150?'#000':'#fff';}
    function loadTheme(){try{window.__pmTheme={...window.__pmTheme,...JSON.parse(localStorage.getItem('ST_SMS_THEME'))};}catch{}}
    function saveTheme(){try{localStorage.setItem('ST_SMS_THEME',JSON.stringify(window.__pmTheme));}catch{}}
    function loadBgSettings(){try{window.__pmBgGlobal=localStorage.getItem('ST_SMS_BG_GLOBAL')||'';}catch{}try{window.__pmBgLocal=JSON.parse(localStorage.getItem('ST_SMS_BG_LOCAL'))||{};}catch{}}
    function saveBgGlobal(){try{localStorage.setItem('ST_SMS_BG_GLOBAL',window.__pmBgGlobal);}catch{}}
    function saveBgLocal(){try{localStorage.setItem('ST_SMS_BG_LOCAL',JSON.stringify(window.__pmBgLocal));}catch{}}
    function loadGroups(){try{window.__pmGroups=JSON.parse(localStorage.getItem('ST_SMS_GROUPS'))||{};}catch{}}
    function saveGroups(){try{localStorage.setItem('ST_SMS_GROUPS',JSON.stringify(window.__pmGroups));}catch{}}

    function applyTheme(){
        const el=phoneWindow;if(!el)return;const t=window.__pmTheme;
        const p=THEME_PRESETS[t.preset]||THEME_PRESETS.default;
        el.style.setProperty('--pm-r-bg',t.customRight||p.right);
        el.style.setProperty('--pm-l-bg',t.customLeft||p.left);
        el.style.setProperty('--pm-r-txt',t.customRight?contrastText(t.customRight):p.rightText);
        el.style.setProperty('--pm-l-txt',t.customLeft?contrastText(t.customLeft):p.leftText);
        el.style.setProperty('--pm-border',t.borderColor||'#1a1a1a');
        el.style.setProperty('--pm-frost',p.frost?'1':'0');
    }
    function applyBackground(){
        const ml=phoneWindow?.querySelector('.pm-msg-list');if(!ml)return;
        const id=getStorageId(),lk=`${id}_${currentPersona}`;
        const bg=window.__pmBgLocal[lk]||window.__pmBgGlobal||'';
        if(bg){ml.style.setProperty('background-image',`url(${bg})`,'important');ml.style.setProperty('background-size','cover','important');ml.style.setProperty('background-position','center','important');}
        else{ml.style.removeProperty('background-image');ml.style.removeProperty('background-size');ml.style.removeProperty('background-position');}
    }

    // ── 图片裁剪对话框 ──
    function showCropDialog(imgSrc) {
        return new Promise((resolve) => {
            const ov = document.createElement('div'); ov.className = 'pm-crop-overlay';
            if (POPOVER_SUPPORTED) ov.setAttribute('popover','manual');
            const cropW = Math.min(300, window.innerWidth - 40);
            const cropH = Math.round(cropW * 1.4); // 接近手机消息区比例
            let scale = 1, ox = 0, oy = 0, dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
            ov.innerHTML = `
<div class="pm-crop-dialog">
  <div class="pm-crop-title">裁剪背景图</div>
  <div class="pm-crop-container" style="width:${cropW}px;height:${cropH}px;">
    <img class="pm-crop-img" src="${imgSrc}" draggable="false">
    <div class="pm-crop-frame" style="width:${cropW}px;height:${cropH}px;"></div>
  </div>
  <div class="pm-crop-zoom">
    <button class="pm-crop-btn" data-z="-1">➖</button>
    <span class="pm-crop-scale">100%</span>
    <button class="pm-crop-btn" data-z="1">➕</button>
  </div>
  <div class="pm-crop-actions">
    <button class="pm-crop-cancel">取消</button>
    <button class="pm-crop-confirm">确认裁剪</button>
  </div>
</div>`;
            document.body.appendChild(ov);
            if (ov.showPopover) try { ov.showPopover(); } catch {}

            const img = ov.querySelector('.pm-crop-img');
            const container = ov.querySelector('.pm-crop-container');
            const scaleLabel = ov.querySelector('.pm-crop-scale');
            const updateImg = () => { img.style.transform = `translate(${ox}px,${oy}px) scale(${scale})`; scaleLabel.textContent = Math.round(scale*100)+'%'; };

            // 等图片加载后居中
            img.onload = () => {
                const ratio = Math.max(cropW/img.naturalWidth, cropH/img.naturalHeight);
                scale = ratio; ox = (cropW - img.naturalWidth*scale)/2; oy = (cropH - img.naturalHeight*scale)/2;
                updateImg();
            };
            if (img.complete) img.onload();

            // 拖动
            const gc = (e) => e.touches ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : {x:e.clientX,y:e.clientY};
            const onDown = (e) => { dragging=true;const c=gc(e);sx=c.x;sy=c.y;sox=ox;soy=oy;if(e.cancelable)e.preventDefault(); };
            const onMove = (e) => { if(!dragging)return;const c=gc(e);ox=sox+(c.x-sx);oy=soy+(c.y-sy);updateImg();if(e.cancelable)e.preventDefault(); };
            const onUp = () => { dragging=false; };
            container.addEventListener('mousedown',onDown);window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);
            container.addEventListener('touchstart',onDown,{passive:false});window.addEventListener('touchmove',onMove,{passive:false});window.addEventListener('touchend',onUp);

            // 缩放
            ov.querySelectorAll('.pm-crop-btn').forEach(btn => {
                btn.onclick = () => {
                    const d = parseInt(btn.dataset.z);
                    const ns = Math.max(0.2, Math.min(5, scale + d*0.15));
                    // 以裁剪框中心为锚点缩放
                    const cx = cropW/2, cy = cropH/2;
                    ox = cx - (cx-ox)*(ns/scale); oy = cy - (cy-oy)*(ns/scale);
                    scale = ns; updateImg();
                };
            });

            // 取消
            ov.querySelector('.pm-crop-cancel').onclick = () => { ov.remove(); resolve(null); };

            // 确认裁剪
            ov.querySelector('.pm-crop-confirm').onclick = () => {
                const canvas = document.createElement('canvas');
                canvas.width = cropW * 2; canvas.height = cropH * 2; // 2x 清晰度
                const ctx2d = canvas.getContext('2d');
                ctx2d.scale(2,2);
                ctx2d.drawImage(img, ox, oy, img.naturalWidth*scale, img.naturalHeight*scale);
                let result = canvas.toDataURL('image/jpeg', 0.8);
                // 二次压缩
                if (result.length > 200*1370) {
                    result = canvas.toDataURL('image/jpeg', 0.5);
                }
                ov.remove(); resolve(result);
            };
        });
    }

    const SPECIAL_KEYWORDS={'转账':'转账','transfer':'转账','Transfer':'转账','TRANSFER':'转账','图片':'图片','image':'图片','Image':'图片','IMAGE':'图片','img':'图片','pic':'图片','photo':'图片','语音':'语音','voice':'语音','Voice':'语音','VOICE':'语音','audio':'语音'};
    const KW_PATTERN=Object.keys(SPECIAL_KEYWORDS).join('|');
    const SPECIAL_RE=new RegExp(`[\\(（]\\s*(${KW_PATTERN})\\s*[+：:\\s]*([^)）]+)[\\)）]`,'gi');
    function normalizeKeyword(k){return SPECIAL_KEYWORDS[k]||SPECIAL_KEYWORDS[k.toLowerCase()]||k;}

    function getStorageId(){const c=getCtx();if(!c)return'sms_unknown__default';const ch=c.characters?.[c.characterId];const av=ch?.avatar||`idx_${c.characterId}`;const cf=c.chatId||(typeof c.getCurrentChatId==='function'?c.getCurrentChatId():null)||c.chat_metadata?.chat_id_hash||c.chat_file||'default';return`sms_${av}__${cf}`;}
    function migrateOldHistory(){if(localStorage.getItem('ST_SMS_MIGRATED_V3'))return;const c=getCtx();if(!c)return;try{const od=window.__pmHistories||{},nd={};let mg=0;for(const k of Object.keys(od)){if(k.startsWith('sms_')){nd[k]=od[k];continue;}const m=k.match(/^(\d+)_(.+)$/);if(!m){nd[k]=od[k];continue;}const ch=c.characters?.[parseInt(m[1])];if(ch?.avatar){nd[`sms_${ch.avatar}__${m[2]}`]=od[k];mg++;}else nd[k]=od[k];}window.__pmHistories=nd;localStorage.setItem('ST_SMS_DATA_V2',JSON.stringify(nd));localStorage.setItem('ST_SMS_MIGRATED_V3','1');}catch{}}
    function normalizeApiUrls(i){let u=(i||'').trim().replace(/\/+$/,'');if(!u)return{chatUrl:'',modelsUrl:''};if(/\/chat\/completions$/i.test(u))return{chatUrl:u,modelsUrl:u.replace(/\/chat\/completions$/i,'/models')};if(/\/models$/i.test(u))return{chatUrl:u.replace(/\/models$/i,'/chat/completions'),modelsUrl:u};if(/\/v\d+$/i.test(u))return{chatUrl:u+'/chat/completions',modelsUrl:u+'/models'};return{chatUrl:u+'/v1/chat/completions',modelsUrl:u+'/v1/models'};}
    function loadProfiles(){try{window.__pmProfiles=JSON.parse(localStorage.getItem('ST_SMS_API_PROFILES'))||[];}catch{window.__pmProfiles=[];}}
    function saveProfiles(){try{localStorage.setItem('ST_SMS_API_PROFILES',JSON.stringify(window.__pmProfiles));}catch{}}
    function addOrUpdateProfile(p){if(!p.apiUrl||!p.apiKey)return;const i=window.__pmProfiles.findIndex(x=>x.apiUrl===p.apiUrl&&x.apiKey===p.apiKey);if(i>=0)window.__pmProfiles[i]={...window.__pmProfiles[i],...p,savedAt:Date.now()};else window.__pmProfiles.push({...p,savedAt:Date.now()});saveProfiles();}
    window.__pmDeleteProfile=(i)=>{window.__pmProfiles.splice(i,1);saveProfiles();window.__pmShowConfig();};
    window.__pmPickProfile=(i)=>{const p=window.__pmProfiles[i];if(!p)return;const u=document.getElementById('pm-cfg-url'),k=document.getElementById('pm-cfg-key'),m=document.getElementById('pm-cfg-model');if(u)u.value=p.apiUrl||'';if(k)k.value=p.apiKey||'';if(m)m.value=p.model||'';};
    window.__pmSetMode=(v)=>{window.__pmConfig.useIndependent=!!v;try{localStorage.setItem('ST_SMS_CONFIG',JSON.stringify(window.__pmConfig));}catch{}const a=document.getElementById('pm-mode-main'),b=document.getElementById('pm-mode-indep'),t=document.getElementById('pm-mode-tip');if(a&&b){a.classList.toggle('pm-mode-active',!v);b.classList.toggle('pm-mode-active',!!v);}if(t)t.textContent=v?'🔌 独立API':'🏠 主API';};
    function loadBidirectional(){try{window.__pmBidirectional=JSON.parse(localStorage.getItem('ST_SMS_BIDIRECTIONAL'))||{};}catch{window.__pmBidirectional={};}}
    function saveBidirectional(){try{localStorage.setItem('ST_SMS_BIDIRECTIONAL',JSON.stringify(window.__pmBidirectional));}catch{}}
    function applyBidirectionalInjection(){const c=getCtx();if(!c||typeof c.setExtensionPrompt!=='function')return;const id=getStorageId(),ck=window.__pmBidirectional[id]||[],hs=window.__pmHistories[id]||{};if(!ck.length){try{c.setExtensionPrompt(BIDIRECTIONAL_KEY,'',1,4);}catch{}return;}const bl=ck.map(n=>{const cv=(hs[n]||[]).slice(-BIDIRECTIONAL_LIMIT);if(!cv.length)return'';return`【与${n}的短信—仅${n}与用户知晓】\n`+cv.map(m=>{const t=(m.content||'').replace(/\s*\/\s*/g,'。');return m.role==='user'?`用户：${t}`:`${n}：${t}`;}).join('\n');}).filter(Boolean).join('\n\n');if(!bl){try{c.setExtensionPrompt(BIDIRECTIONAL_KEY,'',1,4);}catch{}return;}try{c.setExtensionPrompt(BIDIRECTIONAL_KEY,`[短信记忆—私密]\n${bl}\n[结束]`,1,4);}catch{}}
    window.__pmToggleBidirectional=(n)=>{const id=getStorageId(),a=window.__pmBidirectional[id]||[],i=a.indexOf(n);if(i>=0)a.splice(i,1);else{if(a.length>=MAX_BIDIRECTIONAL)return;a.push(n);}window.__pmBidirectional[id]=a;saveBidirectional();applyBidirectionalInjection();window.__pmShowList();};

    async function gatherContext(){const c=getCtx(),ch=c?.characters?.[c.characterId]||{};const cl=(s)=>(s||'').replace(/```[\s\S]*?```/g,'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<[^>]+>/g,'').trim();const mc=(c?.chat||[]).slice(-8).map(m=>({who:m.is_user?'用户':(m.name||'角色'),content:cl(m.mes||'')})).filter(m=>m.content);const mt=mc.map(m=>`${m.who}：${m.content}`).join('\n');let wb='';try{if(typeof c?.getWorldInfoPrompt==='function'){const wi=await c.getWorldInfoPrompt((c.chat||[]).map(m=>m.mes||'').slice(-10),4096,false);wb=wi?.worldInfoString||wi?.worldInfoBefore||'';if(!wb&&wi&&typeof wi==='object')wb=[wi.worldInfoBefore,wi.worldInfoAfter].filter(Boolean).join('\n');}}catch{}return{cardDesc:ch.description??'',cardPersonality:ch.personality??'',cardScenario:ch.scenario??'',cardFirstMes:ch.first_mes??'',cardMesExample:ch.mes_example??'',mainChatText:mt,worldBookText:wb};}

    function bindIsland(el,handle){let isDrag=false,sx,sy,stx=0,sty=0,moved=false;const gc=(e)=>e.touches?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY};const getT=()=>{const m=(el.style.transform||'').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);return m?{x:parseFloat(m[1]),y:parseFloat(m[2])}:{x:0,y:0};};const onS=(e)=>{if(e.target.tagName==='BUTTON')return;isDrag=true;moved=false;const c=gc(e);sx=c.x;sy=c.y;const t=getT();stx=t.x;sty=t.y;el.style.transition='none';if(e.cancelable)e.preventDefault();};const onM=(e)=>{if(!isDrag)return;const c=gc(e),dx=c.x-sx,dy=c.y-sy;if(!moved&&Math.abs(dx)<5&&Math.abs(dy)<5)return;moved=true;if(e.cancelable)e.preventDefault();el.style.setProperty('transform',`translate(${stx+dx}px,${sty+dy}px)`,'important');};const onE=()=>{if(!isDrag)return;isDrag=false;el.style.transition='.35s cubic-bezier(.18,.89,.32,1.2)';if(!moved)window.__pmToggleMin();};handle.addEventListener('mousedown',onS);window.addEventListener('mousemove',onM);window.addEventListener('mouseup',onE);handle.addEventListener('touchstart',onS,{passive:false});window.addEventListener('touchmove',onM,{passive:false});window.addEventListener('touchend',onE);}

    function escapeHtml(s){return(s||'').replace(/</g,'<').replace(/>/g,'>');}
    function escapeAttr(s){return(s||'').replace(/"/g,'"').replace(/</g,'<');}

    // 自适应名字字号
    function fitName(){
        const el=phoneWindow?.querySelector('.pm-name');if(!el)return;
        el.style.fontSize='15px';
        requestAnimationFrame(()=>{
            let fs=15;
            while(el.scrollWidth>el.clientWidth&&fs>9){fs--;el.style.fontSize=fs+'px';}
        });
    }

    function createBubbles(text,side,senderName){
        const results=[];const re=new RegExp(SPECIAL_RE.source,'gi');let last=0,m;
        const isGrp=!!senderName&&side==='left';
        const gcol=isGrp&&groupColorMap[senderName]?groupColorMap[senderName]:null;
        const pushPlain=(str)=>{
            const plain=str.trim();if(!plain)return;
            if(isGrp){
                const wrap=document.createElement('div');wrap.className='pm-group-bubble-wrap';
                const tag=document.createElement('div');tag.className='pm-group-name';tag.textContent=senderName;
                if(gcol)tag.style.color=gcol.bg;
                wrap.appendChild(tag);
                const b=document.createElement('div');b.className='pm-bubble pm-left';
                if(gcol){b.style.setProperty('background',gcol.bg,'important');b.style.setProperty('color',gcol.text,'important');}
                b.innerHTML=escapeHtml(plain).replace(/\n/g,'<br>');
                wrap.appendChild(b);results.push(wrap);
            }else{
                const b=document.createElement('div');b.className=`pm-bubble pm-${side}`;
                b.innerHTML=escapeHtml(plain).replace(/\n/g,'<br>');results.push(b);
            }
        };
        while((m=re.exec(text))!==null){
            if(m.index>last)pushPlain(text.slice(last,m.index));
            const kind=normalizeKeyword(m[1]);
            if(kind==='语音'){
                const txt=m[2].trim(),len=[...txt].length;
                const dur=Math.min(VOICE_MAX_SEC,Math.max(1,len*2));
                const width=Math.min(240,Math.max(100,80+len*5));
                if(isGrp){
                    const wrap=document.createElement('div');wrap.className='pm-group-bubble-wrap';
                    const tag=document.createElement('div');tag.className='pm-group-name';tag.textContent=senderName;
                    if(gcol)tag.style.color=gcol.bg;
                    wrap.appendChild(tag);
                    const b=document.createElement('div');b.className='pm-bubble pm-left pm-special';
                    // 🔧 群聊语音条用角色颜色而非CSS变量
                    const vbg=gcol?gcol.bg:'var(--pm-l-bg)';const vtxt=gcol?gcol.text:'var(--pm-l-txt)';
                    b.innerHTML=`<div class="pm-voice-wrap"><div class="pm-voice-card" style="width:${width}px;background:${vbg};color:${vtxt};border-bottom-left-radius:4px;border-radius:18px;" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${dur}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(txt)}</div></div>`;
                    wrap.appendChild(b);results.push(wrap);
                }else{
                    const b=document.createElement('div');b.className=`pm-bubble pm-${side} pm-special`;
                    b.innerHTML=`<div class="pm-voice-wrap"><div class="pm-voice-card pm-voice-${side}" style="width:${width}px" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">🎤</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${dur}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(txt)}</div></div>`;
                    results.push(b);
                }
            }else{
                const b=document.createElement('div');b.className=`pm-bubble pm-${side} pm-special`;
                if(kind==='转账'){const amt=parseFloat(m[2])||0;b.innerHTML=`<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>转账</b><span>¥${amt.toFixed(2)}</span></div></div>`;}
                else{b.innerHTML=`<div class="pm-img-card">🖼️ ${escapeHtml(m[2].trim())}</div>`;}
                results.push(b);
            }
            last=m.index+m[0].length;
        }
        if(last<text.length)pushPlain(text.slice(last));
        if(!results.length)pushPlain(text);
        return results;
    }

    window.__pmToggleVoice=(el)=>{const t=el.parentElement?.querySelector('.pm-voice-text');if(t)t.style.display=t.style.display==='none'?'block':'none';};
    function cleanResponse(raw){return(raw??'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<thinking>[\s\S]*?<\/thinking>/gi,'').replace(/<reasoning>[\s\S]*?<\/reasoning>/gi,'').replace(/<reflection>[\s\S]*?<\/reflection>/gi,'').replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi,'').replace(/<scene>[\s\S]*?<\/scene>/gi,'').replace(/<narration>[\s\S]*?<\/narration>/gi,'').replace(/<action>[\s\S]*?<\/action>/gi,'').replace(/```[\s\S]*?```/g,'').replace(/^.*【[^】]{2,}】.*$/gm,'').replace(/---+[\s\S]*$/g,'').replace(/<[^>]+>/g,'').trim();}
    function splitToSentences(s){return(s||'').split(/\s*\/\s*/).map(x=>x.trim()).filter(x=>x.length>0).slice(0,8);}

    function parseGroupResponse(raw){
        const cleaned=cleanResponse(raw),lines=cleaned.split('\n').filter(l=>l.trim());
        const result=[],ms=new Set(groupMembers.map(n=>n.toLowerCase()));
        for(const line of lines){
            const mt=line.match(/^(.{1,20})[：:]\s*(.+)$/);
            if(mt&&ms.has(mt[1].trim().toLowerCase())){
                const name=groupMembers.find(n=>n.toLowerCase()===mt[1].trim().toLowerCase())||mt[1].trim();
                const sents=mt[2].split(/\s*\/\s*/).map(s=>s.trim()).filter(Boolean).slice(0,8);
                if(sents.length)result.push({name,sentences:sents});
            }else{
                const sents=line.split(/\s*\/\s*/).map(s=>s.trim()).filter(Boolean).slice(0,8);
                if(sents.length){if(result.length>0)result[result.length-1].sentences.push(...sents);else result.push({name:groupMembers[0]||'???',sentences:sents});}
            }
        }
        return result;
    }
    // ── API 调用 ──
    async function fetchSMS(userMsg){
        const c=getCtx();conversationHistory.push({role:'user',content:userMsg});
        const ctx=await gatherContext();
        const{cardDesc,cardPersonality,cardScenario,cardFirstMes,cardMesExample,mainChatText,worldBookText}=ctx;
        const smsHist=conversationHistory.slice(-CONTEXT_LIMIT).map(m=>{const cl=cleanResponse(m.content);return m.role==='user'?`用户：${cl}`:(isGroupChat?cl:`${currentPersona}：${cl}`);}).join('\n');

        let injected,sysPr;
        if(isGroupChat){
            const ml=groupMembers.join('、');
            const grpInfo=groupDisplayName?`群名「${groupDisplayName}」，`:'';
            injected=`[群聊短信——最高优先级]\n${grpInfo}成员：${ml}\n你同时扮演以上角色与用户群聊。\n\n输出格式：\n角色名：消息1 / 消息2\n另一角色：消息3\n\n规则：\n- 根据剧情性格决定谁发言，可穿插\n- 每角色0-8句，用/分隔\n- 不必所有人都说话\n- 禁止旁白心理场景标签\n- 特殊格式（中文）：(转账+金额)(图片+描述)(语音+内容)\n- 严禁英文格式\n${cardScenario?'【场景】\n'+cardScenario+'\n':''}${worldBookText?'【世界书】\n'+worldBookText+'\n':''}群聊历史：\n${smsHist}\n\n用户：${userMsg}`;
            sysPr=[`你同时扮演${ml}在群聊「${groupDisplayName||'群聊'}」中与用户对话。`,cardDesc?`【角色设定】\n${cardDesc}`:'',cardPersonality?`【性格】\n${cardPersonality}`:'',cardScenario?`【场景】\n${cardScenario}`:'',worldBookText?`【世界书】\n${worldBookText}`:'',mainChatText?`【主线对话】\n${mainChatText}`:'','',`输出：角色名：消息/消息。可穿插，每角色0-8句。`,'特殊格式（中文）：(转账+金额)(图片+描述)(语音+内容)。严禁英文格式标签旁白。'].filter(Boolean).join('\n\n');
        }else{
            const ctxB=[cardScenario?`【场景参考】\n${cardScenario}`:'',cardMesExample?`【对话示例】\n${cardMesExample}`:''].filter(Boolean).join('\n\n');
            injected=`\n[短信模式——最高优先级]\n角色：${currentPersona}\n以${currentPersona}身份短信回复。\n${ctxB?ctxB+'\n\n':''}规则：\n- 3到8句，/分隔\n- 禁止旁白心理场景标签\n- 特殊格式（中文）：(转账+金额)(图片+描述)(语音+内容)\n- 严禁英文格式\n- 偶尔可(语音+内容)\n\n短信历史：\n${smsHist}\n\n用户：${userMsg}\n${currentPersona}：`;
            sysPr=[`你扮演"${currentPersona}"短信聊天。`,cardDesc?`【角色设定】\n${cardDesc}`:'',cardPersonality?`【性格】\n${cardPersonality}`:'',cardScenario?`【场景】\n${cardScenario}`:'',cardFirstMes?`【开场白】\n${cardFirstMes}`:'',cardMesExample?`【对话示例】\n${cardMesExample}`:'',worldBookText?`【世界书】\n${worldBookText}`:'',mainChatText?`【主线对话】\n${mainChatText}`:'','','3-8句，/分隔。特殊格式（中文）。严禁英文格式标签旁白状态栏。'].filter(Boolean).join('\n\n');
        }
        try{
            let raw='';const cfg=window.__pmConfig,useI=cfg.useIndependent&&cfg.apiUrl&&cfg.apiKey;
            if(useI){
                const msgs=[{role:'system',content:sysPr},...conversationHistory.slice(-CONTEXT_LIMIT).map(m=>({role:m.role,content:cleanResponse(m.content)}))];
                const{chatUrl}=normalizeApiUrls(cfg.apiUrl);
                const r=await fetch(chatUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${cfg.apiKey}`},body:JSON.stringify({model:cfg.model||'gpt-4o-mini',messages:msgs,max_tokens:isGroupChat?600:300,temperature:0.85})});
                const j=await r.json();raw=j.choices?.[0]?.message?.content??'';
            }else{raw=await c.generateQuietPrompt(injected,false,false);}
            console.log('[phone-mode] raw:',raw?.length,JSON.stringify((raw||'').slice(0,300)));

            let resultData;
            if(isGroupChat){
                const parsed=parseGroupResponse(raw);
                if(parsed.length){conversationHistory.push({role:'assistant',content:parsed.map(p=>`${p.name}：${p.sentences.join(' / ')}`).join('\n')});resultData={type:'group',data:parsed};}
                else{conversationHistory.push({role:'assistant',content:raw});resultData={type:'group',data:[{name:groupMembers[0]||'?',sentences:['（解析失败）']}]};}
            }else{
                const cl=cleanResponse(raw);let sents=splitToSentences(cl);
                if(!sents.length&&raw?.trim())sents=splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<[^>]+>/g,''));
                if(!sents.length)sents=!raw?.trim()?['（空响应）']:['（格式无法解析）'];
                conversationHistory.push({role:'assistant',content:sents.join(' / ')});resultData={type:'single',data:sents};
            }
            const id=getStorageId();if(!window.__pmHistories[id])window.__pmHistories[id]={};
            window.__pmHistories[id][currentPersona]=conversationHistory.slice(-SAVE_LIMIT);
            try{localStorage.setItem('ST_SMS_DATA_V2',JSON.stringify(window.__pmHistories));}catch{}
            applyBidirectionalInjection();return resultData;
        }catch(e){console.error('[phone-mode]',e);return isGroupChat?{type:'group',data:[{name:'系统',sentences:[`（错误：${e?.message||e}）`]}]}:{type:'single',data:[`（错误：${e?.message||e}）`]};}
    }

    function addBubble(text,side,sender){const list=phoneWindow?.querySelector('.pm-msg-list');if(!list)return;createBubbles(text,side,sender).forEach(b=>{b.dataset=b.dataset||{};b.dataset.side=side;b.dataset.text=text;list.appendChild(b);});list.scrollTop=list.scrollHeight;}
    function addNote(text){const list=phoneWindow?.querySelector('.pm-msg-list');if(!list)return;const n=document.createElement('div');n.className='pm-note';n.textContent=text;list.appendChild(n);list.scrollTop=list.scrollHeight;}
    function showTyping(){const list=phoneWindow?.querySelector('.pm-msg-list');if(!list||document.getElementById('pm-typing'))return;const t=document.createElement('div');t.id='pm-typing';t.className='pm-bubble pm-left pm-typing-bubble';t.innerHTML='<span></span><span></span><span></span>';list.appendChild(t);list.scrollTop=list.scrollHeight;}
    function hideTyping(){document.getElementById('pm-typing')?.remove();}

    window.__pmSend=async()=>{
        if(isGenerating)return;const input=phoneWindow.querySelector('.pm-input');
        const val=input.value.trim();if(!val)return;input.value='';
        const protect=val.replace(/[\(（][^)）]+[\)\）]/g,m=>m.replace(/\//g,'\u0001'));
        protect.split(/[/／]/).map(s=>s.replace(/\u0001/g,'/').trim()).filter(Boolean).forEach(ch=>addBubble(ch,'right'));
        isGenerating=true;input.disabled=true;const btn=phoneWindow.querySelector('.pm-up-btn');if(btn)btn.disabled=true;
        showTyping();const result=await fetchSMS(val);hideTyping();
        if(result.type==='group'){for(const bl of result.data)for(const s of bl.sentences){await new Promise(r=>setTimeout(r,120));addBubble(s,'left',bl.name);}}
        else{for(const s of result.data){await new Promise(r=>setTimeout(r,150));addBubble(s,'left');}}
        isGenerating=false;input.disabled=false;if(btn)btn.disabled=false;input.focus();
    };

    window.__pmToggleSelect=()=>{
        isSelectMode=!isSelectMode;const list=phoneWindow?.querySelector('.pm-msg-list');
        const tb=phoneWindow?.querySelector('.pm-trash-btn'),cb=phoneWindow?.querySelector('.pm-confirm-bar');if(!list)return;
        if(isSelectMode){tb.style.color='#ff3b30';cb.style.display='flex';list.querySelectorAll('.pm-bubble,.pm-group-bubble-wrap').forEach(b=>{if(b.id==='pm-typing'||b.closest('.pm-select-wrap'))return;const w=document.createElement('div');w.className='pm-select-wrap';const c=document.createElement('div');c.className='pm-custom-check';c.dataset.checked='0';c.onclick=()=>{c.dataset.checked=c.dataset.checked==='0'?'1':'0';};b.parentNode.insertBefore(w,b);w.appendChild(c);w.appendChild(b);w.dataset.side=b.dataset.side||'';w.dataset.text=b.dataset.text||'';});}
        else{tb.style.color='';cb.style.display='none';list.querySelectorAll('.pm-select-wrap').forEach(w=>{const b=w.querySelector('.pm-bubble,.pm-group-bubble-wrap');if(b)w.parentNode.insertBefore(b,w);w.remove();});}
    };
    window.__pmDeleteSelected=()=>{const list=phoneWindow?.querySelector('.pm-msg-list');if(!list)return;const td=new Set();list.querySelectorAll('.pm-select-wrap').forEach(w=>{const c=w.querySelector('.pm-custom-check');if(c?.dataset.checked==='1'){td.add(w.dataset.text);w.remove();}else{const b=w.querySelector('.pm-bubble,.pm-group-bubble-wrap');if(b)w.parentNode.insertBefore(b,w);w.remove();}});if(td.size>0){conversationHistory=conversationHistory.filter(m=>!m.content.split(/\s*\/\s*/).some(p=>td.has(p.trim())));const id=getStorageId();if(!window.__pmHistories[id])window.__pmHistories[id]={};window.__pmHistories[id][currentPersona]=conversationHistory.slice(-SAVE_LIMIT);try{localStorage.setItem('ST_SMS_DATA_V2',JSON.stringify(window.__pmHistories));}catch{}}isSelectMode=false;phoneWindow?.querySelector('.pm-trash-btn')?.style.removeProperty('color');const bar=phoneWindow?.querySelector('.pm-confirm-bar');if(bar)bar.style.display='none';};

    window.__pmShowModelPicker=()=>{const ex=document.getElementById('pm-model-dropdown');if(ex){ex.remove();return;}if(!__pmModelList.length){const s=document.getElementById('pm-api-status');if(s){s.textContent='⚠️ 先拉取模型';s.style.color='#ff9500';}return;}const input=document.getElementById('pm-cfg-model'),rect=input.getBoundingClientRect();const dd=document.createElement('div');dd.id='pm-model-dropdown';dd.className='pm-model-dropdown';if(POPOVER_SUPPORTED)dd.setAttribute('popover','manual');dd.innerHTML=`<input class="pm-model-search" placeholder="🔍 搜索..."/><div class="pm-model-options"></div>`;dd.style.left=rect.left+'px';dd.style.top=(rect.bottom+4)+'px';dd.style.width=rect.width+'px';document.body.appendChild(dd);if(dd.showPopover)try{dd.showPopover();}catch{}const od=dd.querySelector('.pm-model-options');const render=(f='')=>{const fl=f.toLowerCase(),fi=__pmModelList.filter(m=>!fl||m.toLowerCase().includes(fl));od.innerHTML=fi.length?fi.map(m=>`<div class="pm-model-opt" data-m="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join(''):'<div class="pm-model-empty">无匹配</div>';od.querySelectorAll('.pm-model-opt').forEach(el=>el.addEventListener('click',()=>{document.getElementById('pm-cfg-model').value=el.dataset.m;dd.remove();}));};render();dd.querySelector('.pm-model-search').addEventListener('input',function(){render(this.value);});dd.querySelector('.pm-model-search').focus();setTimeout(()=>{const closer=(e)=>{if(!dd.contains(e.target)&&e.target.id!=='pm-model-arrow'){dd.remove();document.removeEventListener('click',closer,true);}};document.addEventListener('click',closer,true);},0);};

    function makeOverlay(html){document.getElementById('pm-overlay')?.remove();const ov=document.createElement('div');ov.id='pm-overlay';if(POPOVER_SUPPORTED)ov.setAttribute('popover','manual');ov.innerHTML=html;ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});document.body.appendChild(ov);if(ov.showPopover)try{ov.showPopover();}catch{}return ov;}

    // ── 群聊创建/编辑弹窗 ──
    window.__pmShowGroupCreate=(existingKey)=>{
        document.getElementById('pm-overlay')?.remove();
        loadGroups();
        const id=getStorageId();
        const grpData=existingKey&&window.__pmGroups[id]?.[existingKey]||null;
        const isEdit=!!grpData;
        const initName=grpData?.name||'';
        const initMembers=grpData?.members?.join(' / ')||'';
        const max=MAX_GROUP_MEMBERS-1;

        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>${isEdit?'编辑群聊':'新建群聊'}</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <div class="pm-cfg-label">群聊名称</div>
    <input id="pm-grp-name" class="pm-cfg-input" placeholder="给群聊取个名字..." value="${escapeAttr(initName)}">
    <div class="pm-cfg-label">群聊成员（用 / 分隔）</div>
    <input id="pm-grp-members" class="pm-cfg-input" placeholder="角色A / 角色B / 角色C" value="${escapeAttr(initMembers)}" oninput="window.__pmGrpInputChanged()">
    <div id="pm-grp-counter" class="pm-cfg-tip" style="text-align:left;font-weight:600;">0/${max}</div>
    <div id="pm-grp-preview" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
  </div>
  <div class="pm-modal-add">
    <button onclick="window.__pmSaveGroup('${escapeAttr(existingKey||'')}')" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">${isEdit?'保存修改':'创建群聊'}</button>
  </div>
</div>`);
        // 初始化计数
        setTimeout(()=>window.__pmGrpInputChanged(),50);
    };

    window.__pmGrpInputChanged=()=>{
        const input=document.getElementById('pm-grp-members');
        const counter=document.getElementById('pm-grp-counter');
        const preview=document.getElementById('pm-grp-preview');
        if(!input)return;
        const names=input.value.split(/[/／]/).map(s=>s.trim()).filter(Boolean);
        const max=MAX_GROUP_MEMBERS-1,count=Math.min(names.length,max),over=names.length>max;
        counter.textContent=`${count}/${max} 个角色${over?' ⚠️ 超出上限':''}`;
        counter.style.color=over?'#ff3b30':'#b87a00';
        preview.innerHTML=names.slice(0,max).map((n,i)=>{const gc=GROUP_COLORS[i%GROUP_COLORS.length];return`<span style="background:${gc.bg};color:${gc.text};padding:3px 8px;border-radius:10px;font-size:11px;">${escapeHtml(n)}</span>`;}).join('');
    };

    window.__pmSaveGroup=(existingKey)=>{
        const nameInput=document.getElementById('pm-grp-name');
        const membersInput=document.getElementById('pm-grp-members');
        if(!nameInput||!membersInput)return;
        const gName=nameInput.value.trim()||'群聊';
        const members=membersInput.value.split(/[/／]/).map(s=>s.trim()).filter(Boolean).slice(0,MAX_GROUP_MEMBERS-1);
        if(members.length<2){alert('至少需要 2 个角色');return;}
        const id=getStorageId();
        if(!window.__pmGroups[id])window.__pmGroups[id]={};
        const storageKey=existingKey||('👥'+gName);

        // 如果改了名，需要迁移历史
        if(existingKey&&existingKey!==('👥'+gName)){
            if(window.__pmHistories[id]?.[existingKey]){
                window.__pmHistories[id]['👥'+gName]=window.__pmHistories[id][existingKey];
                delete window.__pmHistories[id][existingKey];
                try{localStorage.setItem('ST_SMS_DATA_V2',JSON.stringify(window.__pmHistories));}catch{}
            }
            delete window.__pmGroups[id][existingKey];
        }

        window.__pmGroups[id]['👥'+gName]={name:gName,members};
        saveGroups();
        document.getElementById('pm-overlay')?.remove();

        isGroupChat=true;groupMembers=members;groupDisplayName=gName;
        groupColorMap={};members.forEach((n,i)=>{groupColorMap[n]=GROUP_COLORS[i%GROUP_COLORS.length];});
        window.__pmSwitch('👥'+gName);
    };

    // ── 设置弹窗 ──
    window.__pmShowConfig=()=>{
        loadProfiles();loadTheme();loadBgSettings();
        const cfg=window.__pmConfig,t=window.__pmTheme;
        const su=(u)=>(u||'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
        const mk=(k)=>!k?'':(k.length<=8?'****':k.slice(0,4)+'****'+k.slice(-4));
        const profH=window.__pmProfiles.length>0?window.__pmProfiles.map((p,i)=>`<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(su(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(mk(p.apiKey))}${p.model?' · '+escapeHtml(p.model):''}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">✕</i></div>`).join(''):'<div class="pm-prof-empty">暂无档案</div>';
        const useI=!!cfg.useIndependent;
        const preB=Object.entries(THEME_PRESETS).map(([k,v])=>`<div class="pm-theme-chip ${t.preset===k?'pm-theme-active':''}" data-preset="${k}" onclick="window.__pmSetPreset('${k}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`).join('');
        const layB=['standard','relaxed'].map(v=>`<div class="pm-layout-chip ${t.layout===v?'pm-layout-active':''}" onclick="window.__pmSetLayout('${v}')">${v==='standard'?'标准':'宽松'}</div>`).join('');
        const sid=getStorageId(),lk=`${sid}_${currentPersona}`;
        const hasG=!!window.__pmBgGlobal,hasL=!!window.__pmBgLocal[lk];

        // 背景图状态：互斥按钮
        const gBtns=hasG
            ?`<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('global')">清除</button>`
            :`<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'global')" hidden></label><button class="pm-bg-btn" onclick="window.__pmBgUrl('global')">URL</button>`;
        const lBtns=hasL
            ?`<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('local')">清除</button>`
            :`<label class="pm-bg-btn">选择图片<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'local')" hidden></label><button class="pm-bg-btn" onclick="window.__pmBgUrl('local')">URL</button>`;

        makeOverlay(`
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>设置</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div class="pm-cfg-tabs">
    <div class="pm-cfg-tab pm-cfg-tab-active" data-tab="api" onclick="window.__pmSwitchTab('api')">API</div>
    <div class="pm-cfg-tab" data-tab="look" onclick="window.__pmSwitchTab('look')">外观</div>
  </div>
  <div class="pm-modal-scroll">
    <div id="pm-tab-api" class="pm-tab-pane">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">⚡ API 模式</div>
        <div class="pm-mode-switch"><div id="pm-mode-main" class="pm-mode-opt ${!useI?'pm-mode-active':''}" onclick="window.__pmSetMode(false)">🏠 主API</div><div id="pm-mode-indep" class="pm-mode-opt ${useI?'pm-mode-active':''}" onclick="window.__pmSetMode(true)">🔌 独立API</div></div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useI?'🔌 独立API':'🏠 主API'}</div>
      </div>
      <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;"><div class="pm-cfg-label" style="margin:8px 0 6px;">📚 已保存档案</div><div class="pm-prof-list">${profH}</div></div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label">API 地址</div><input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://..." value="${escapeAttr(cfg.apiUrl||'')}">
        <div class="pm-cfg-label">API Key</div><input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${escapeAttr(cfg.apiKey||'')}" maxlength="999">
        <div class="pm-cfg-label">模型名称</div><div class="pm-model-row"><input id="pm-cfg-model" class="pm-cfg-input" placeholder="手动输入或▼" value="${escapeAttr(cfg.model||'')}"><button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">▼</button></div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">连接成功后自动保存</div>
      </div>
    </div>
    <div id="pm-tab-look" class="pm-tab-pane" style="display:none;">
      <div style="padding:10px 16px;"><div class="pm-cfg-label" style="margin-bottom:8px;">📐 界面布局</div><div class="pm-layout-row">${layB}</div></div>
      <div style="padding:10px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">🎨 气泡主题</div>
        <div class="pm-theme-row">${preB}</div>
        <div class="pm-custom-color-section">
          <div class="pm-custom-color-row"><label class="pm-cfg-label" style="margin:0;">自定义右</label><input id="pm-custom-right" type="color" value="${t.customRight||'#007aff'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick"><label class="pm-cfg-label" style="margin:0;">自定义左</label><input id="pm-custom-left" type="color" value="${t.customLeft||'#e9e9eb'}" onchange="window.__pmSetCustomColor()" class="pm-color-pick"><button onclick="window.__pmClearCustomColor()" class="pm-color-clear">重置</button></div>
          <div class="pm-custom-color-row"><label class="pm-cfg-label" style="margin:0;">边框颜色</label><input id="pm-border-color" type="color" value="${t.borderColor||'#1a1a1a'}" onchange="window.__pmSetBorderColor()" class="pm-color-pick"><button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">重置</button></div>
        </div>
      </div>
      <div style="padding:10px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">🖼 背景图</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div class="pm-bg-row"><span class="pm-bg-label">全局背景</span>${gBtns}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">本联系人</span>${lBtns}</div>
        </div>
      </div>
    </div>
  </div>
  <div id="pm-cfg-bottom-btns" class="pm-modal-add" style="display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;gap:6px;"><button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🔗 拉取模型</button><button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">🧪 测试</button></div>
    <button onclick="window.__pmSaveConfig()" style="background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">保存配置</button>
  </div>
</div>`);
    };

    window.__pmSwitchTab=(tab)=>{
        document.querySelectorAll('.pm-cfg-tab').forEach(el=>el.classList.toggle('pm-cfg-tab-active',el.dataset.tab===tab));
        document.querySelectorAll('.pm-tab-pane').forEach(el=>el.style.display='none');
        const pane=document.getElementById(`pm-tab-${tab}`);if(pane)pane.style.display='block';
        // 🔧 API按钮只在API页显示
        const btns=document.getElementById('pm-cfg-bottom-btns');
        if(btns)btns.style.display=tab==='api'?'flex':'none';
    };

    window.__pmSetPreset=(p)=>{window.__pmTheme.preset=p;window.__pmTheme.customRight='';window.__pmTheme.customLeft='';saveTheme();applyTheme();document.querySelectorAll('.pm-theme-chip').forEach(el=>el.classList.toggle('pm-theme-active',el.dataset.preset===p));};
    window.__pmSetCustomColor=()=>{window.__pmTheme.customRight=document.getElementById('pm-custom-right')?.value||'';window.__pmTheme.customLeft=document.getElementById('pm-custom-left')?.value||'';window.__pmTheme.preset='custom';saveTheme();applyTheme();document.querySelectorAll('.pm-theme-chip').forEach(el=>el.classList.remove('pm-theme-active'));};
    window.__pmClearCustomColor=()=>{window.__pmTheme.customRight='';window.__pmTheme.customLeft='';window.__pmTheme.preset='default';saveTheme();applyTheme();const r=document.getElementById('pm-custom-right'),l=document.getElementById('pm-custom-left');if(r)r.value='#007aff';if(l)l.value='#e9e9eb';document.querySelectorAll('.pm-theme-chip').forEach(el=>el.classList.toggle('pm-theme-active',el.dataset.preset==='default'));};
    window.__pmSetBorderColor=()=>{window.__pmTheme.borderColor=document.getElementById('pm-border-color')?.value||'#1a1a1a';saveTheme();applyTheme();};
    window.__pmSetLayout=(v)=>{window.__pmTheme.layout=v;saveTheme();if(phoneWindow)phoneWindow.dataset.layout=v;document.querySelectorAll('.pm-layout-chip').forEach(el=>el.classList.toggle('pm-layout-active',el.textContent===(v==='standard'?'标准':'宽松')));};

    // ── 背景图回调（带裁剪） ──
    window.__pmUploadBg=async(input,scope)=>{
        const file=input.files?.[0];if(!file)return;
        try{
            // 先读取原图为 data URL
            const rawUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});
            // 弹出裁剪对话框
            const cropped=await showCropDialog(rawUrl);
            if(!cropped)return; // 用户取消
            if(scope==='global'){window.__pmBgGlobal=cropped;saveBgGlobal();}
            else{const sid=getStorageId();window.__pmBgLocal[`${sid}_${currentPersona}`]=cropped;saveBgLocal();}
            applyBackground();
            // 刷新到外观页
            window.__pmShowConfig();setTimeout(()=>window.__pmSwitchTab('look'),50);
        }catch(e){alert('图片处理失败: '+e.message);}
    };
    window.__pmBgUrl=(scope)=>{const url=prompt('输入图片 URL：');if(!url?.trim())return;if(scope==='global'){window.__pmBgGlobal=url.trim();saveBgGlobal();}else{const sid=getStorageId();window.__pmBgLocal[`${sid}_${currentPersona}`]=url.trim();saveBgLocal();}applyBackground();window.__pmShowConfig();setTimeout(()=>window.__pmSwitchTab('look'),50);};
    window.__pmClearBg=(scope)=>{if(scope==='global'){window.__pmBgGlobal='';saveBgGlobal();}else{const sid=getStorageId();delete window.__pmBgLocal[`${sid}_${currentPersona}`];saveBgLocal();}applyBackground();window.__pmShowConfig();setTimeout(()=>window.__pmSwitchTab('look'),50);};

    window.__pmTestApi=async()=>{const u=document.getElementById('pm-cfg-url').value.trim(),k=document.getElementById('pm-cfg-key').value.trim(),m=document.getElementById('pm-cfg-model').value.trim();const s=document.getElementById('pm-api-status');if(!u){s.textContent="❌ 填写地址";s.style.color="#ff3b30";return;}s.textContent="连接中...";s.style.color="#007aff";try{const r=await fetch(normalizeApiUrls(u).modelsUrl,{method:'GET',headers:{'Authorization':`Bearer ${k}`}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();if(d?.data&&Array.isArray(d.data)){__pmModelList=d.data.map(x=>x.id).filter(Boolean);s.textContent=`✅ ${__pmModelList.length}个模型`;s.style.color="#34c759";}else{s.textContent="✅ 连接成功";s.style.color="#34c759";}addOrUpdateProfile({apiUrl:u,apiKey:k,model:m});}catch(e){s.textContent="❌ "+e.message;s.style.color="#ff3b30";}};
    window.__pmTestModel=async()=>{const u=document.getElementById('pm-cfg-url').value.trim(),k=document.getElementById('pm-cfg-key').value.trim(),m=document.getElementById('pm-cfg-model').value.trim();const s=document.getElementById('pm-api-status');if(!u||!k||!m){s.textContent='❌ 填完整';s.style.color='#ff3b30';return;}s.textContent=`测试「${m}」...`;s.style.color='#007aff';const ctrl=new AbortController();const tm=setTimeout(()=>ctrl.abort(),15000);try{const r=await fetch(normalizeApiUrls(u).chatUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${k}`},body:JSON.stringify({model:m,messages:[{role:'user',content:'hi'}],max_tokens:16}),signal:ctrl.signal});clearTimeout(tm);if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json(),rp=j.choices?.[0]?.message?.content;s.textContent=rp!=null?`✅ "${String(rp).slice(0,25)}"`:'⚠️ 异常';s.style.color=rp!=null?'#34c759':'#ff9500';}catch(e){clearTimeout(tm);s.textContent='❌ '+(e.name==='AbortError'?'超时':e.message);s.style.color='#ff3b30';}};
    window.__pmSaveConfig=()=>{const apiUrl=document.getElementById('pm-cfg-url')?.value.trim()??'',apiKey=document.getElementById('pm-cfg-key')?.value.trim()??'',model=document.getElementById('pm-cfg-model')?.value.trim()??'';window.__pmConfig={apiUrl,apiKey,model,useIndependent:!!window.__pmConfig.useIndependent};try{localStorage.setItem('ST_SMS_CONFIG',JSON.stringify(window.__pmConfig));}catch{}if(apiUrl&&apiKey)addOrUpdateProfile({apiUrl,apiKey,model});document.getElementById('pm-overlay')?.remove();addNote(`已保存：${window.__pmConfig.useIndependent&&apiUrl?'独立API':'主API'}`);};
    // ── 联系人弹窗 ──
    window.__pmShowList=()=>{
        const id=getStorageId(),list=Object.keys(window.__pmHistories[id]||{}),checked=window.__pmBidirectional[id]||[];
        loadGroups();
        makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>联系人</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">✕</span></div>
  <div class="pm-bi-bar"><span>🧠 勾选角色可被主楼读取短信</span><span class="pm-bi-tip">已选 ${checked.length}/${MAX_BIDIRECTIONAL}</span></div>
  <div class="pm-modal-list">
    ${list.length>0?list.map(n=>{
        const isChk=checked.includes(n);
        const isGrp=n.startsWith('👥');
        return`<div class="pm-li">
          ${isGrp?'':'<div class="pm-custom-check pm-bi-style '+(isChk?'is-checked':'')+'" onclick="event.stopPropagation();window.__pmToggleBidirectional(\''+n.replace(/'/g,"\\'")+"')\"></div>"}
          ${isGrp?'<span class="pm-grp-icon">👥</span>':''}
          <span onclick="window.__pmSwitchContact('${n.replace(/'/g,"\\'")}')">${escapeHtml(n.replace(/^👥/,'').trim())}</span>
          ${isGrp?'<i class="pm-li-edit" onclick="event.stopPropagation();window.__pmShowGroupCreate(\''+escapeAttr(n)+'\')">✏️</i>':''}
          <i onclick="window.__pmDel('${n.replace(/'/g,"\\'")}')">删除</i>
        </div>`;
    }).join(''):'<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无联系人</div>'}
  </div>
  <div class="pm-contact-bottom">
    <button class="pm-contact-btn pm-contact-group" onclick="window.__pmShowGroupCreate()">👥 新建群聊</button>
    <button class="pm-contact-btn pm-contact-add" onclick="window.__pmShowAddContact()">＋ 添加联系人</button>
  </div>
</div>`);
    };

    window.__pmShowAddContact=()=>{
        const nameEl=document.querySelector('.pm-contact-bottom');
        if(!nameEl)return;
        // 替换底部为输入框
        nameEl.innerHTML=`<div style="display:flex;gap:8px;width:100%;"><input id="pm-add-input" class="pm-cfg-input" placeholder="输入角色名..." style="flex:1;"><button class="pm-contact-btn pm-contact-add" onclick="window.__pmSwitchContact(document.getElementById('pm-add-input').value.trim())">开始</button></div>`;
        setTimeout(()=>{
            const inp=document.getElementById('pm-add-input');
            if(inp){inp.focus();inp.addEventListener('keydown',e=>{if(e.key==='Enter')window.__pmSwitchContact(inp.value.trim());});}
        },50);
    };

    window.__pmSwitchContact=(name)=>{
        if(!name?.trim())return;name=name.trim();
        loadGroups();
        const id=getStorageId();
        if(name.startsWith('👥')){
            const grpData=window.__pmGroups[id]?.[name];
            if(grpData){
                isGroupChat=true;groupMembers=grpData.members;groupDisplayName=grpData.name;
                groupColorMap={};grpData.members.forEach((n,i)=>{groupColorMap[n]=GROUP_COLORS[i%GROUP_COLORS.length];});
            }else{
                // 旧格式群聊兼容
                const members=name.replace('👥','').trim().split('、').map(s=>s.trim()).filter(Boolean);
                isGroupChat=true;groupMembers=members;groupDisplayName=name.replace('👥','').trim();
                groupColorMap={};members.forEach((n,i)=>{groupColorMap[n]=GROUP_COLORS[i%GROUP_COLORS.length];});
            }
        }else{
            isGroupChat=false;groupMembers=[];groupColorMap={};groupDisplayName='';
        }
        window.__pmSwitch(name);
    };

    window.__pmSwitch=(name)=>{
        if(!name?.trim())return;name=name.trim();
        document.getElementById('pm-overlay')?.remove();
        const id=getStorageId();currentPersona=name;
        conversationHistory=window.__pmHistories[id]?.[name]??[];
        if(phoneWindow){
            // 显示名字：群聊显示自定义名或成员名
            const displayName=isGroupChat?(groupDisplayName||name.replace('👥','').trim()):name;
            phoneWindow.querySelector('.pm-name').textContent=displayName;
            // 群聊编辑按钮
            const editBtn=phoneWindow.querySelector('.pm-grp-edit-btn');
            if(editBtn)editBtn.style.display=isGroupChat?'inline':'none';

            fitName();
            const list=phoneWindow.querySelector('.pm-msg-list');list.innerHTML='';
            if(conversationHistory.length>0){
                addNote('历史记录');
                conversationHistory.forEach(m=>{
                    if(isGroupChat&&m.role==='assistant'){
                        const lines=m.content.split('\n');
                        for(const line of lines){
                            const mt=line.match(/^(.{1,20})[：:]\s*(.+)$/);
                            if(mt&&groupMembers.some(gm=>gm.toLowerCase()===mt[1].trim().toLowerCase())){
                                const sender=groupMembers.find(gm=>gm.toLowerCase()===mt[1].trim().toLowerCase());
                                const pr=mt[2].replace(/[\(（][^)）]+[\)\）]/g,mm=>mm.replace(/\//g,'\u0001'));
                                pr.split(/\s*\/\s*/).map(s=>s.replace(/\u0001/g,'/').trim()).filter(Boolean).forEach(s=>addBubble(s,'left',sender));
                            }else{
                                const pr=line.replace(/[\(（][^)）]+[\)\）]/g,mm=>mm.replace(/\//g,'\u0001'));
                                pr.split(/\s*\/\s*/).map(s=>s.replace(/\u0001/g,'/').trim()).filter(Boolean).forEach(s=>addBubble(s,'left'));
                            }
                        }
                    }else{
                        const pr=m.content.replace(/[\(（][^)）]+[\)\）]/g,mm=>mm.replace(/\//g,'\u0001'));
                        pr.split(/\s*\/\s*/).map(s=>s.replace(/\u0001/g,'/').trim()).filter(Boolean).forEach(s=>addBubble(s,m.role==='user'?'right':'left'));
                    }
                });
                addNote('── 以上为历史 ──');
            }else addNote('开始对话');
            applyBackground();
        }
        applyBidirectionalInjection();
    };

    window.__pmDel=(name)=>{const id=getStorageId();if(window.__pmHistories[id])delete window.__pmHistories[id][name];try{localStorage.setItem('ST_SMS_DATA_V2',JSON.stringify(window.__pmHistories));}catch{}if(window.__pmGroups[id])delete window.__pmGroups[id][name];saveGroups();const a=window.__pmBidirectional[id]||[],i=a.indexOf(name);if(i>=0){a.splice(i,1);window.__pmBidirectional[id]=a;saveBidirectional();}applyBidirectionalInjection();window.__pmShowList();};
    window.__pmToggleMin=()=>{isMinimized=!isMinimized;phoneWindow.classList.toggle('is-min',isMinimized);phoneWindow.style.removeProperty('transform');};
    window.__pmEnd=()=>{if(phoneWindow){try{phoneWindow.hidePopover?.();}catch{}phoneWindow.remove();}phoneWindow=null;phoneActive=false;isMinimized=false;isSelectMode=false;isGroupChat=false;groupMembers=[];groupColorMap={};groupDisplayName='';};

    function ensureVisibility(){if(!phoneWindow)return;const cs=getComputedStyle(phoneWindow);if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity||'1')<0.1){phoneWindow.style.setProperty('display','flex','important');phoneWindow.style.setProperty('visibility','visible','important');phoneWindow.style.setProperty('opacity','1','important');}}
    setInterval(ensureVisibility,2000);

    // ── 打开窗口 ──
    window.__pmOpen=()=>{
        if(phoneActive&&phoneWindow){try{phoneWindow.showPopover?.();}catch{}phoneWindow.style.display='flex';ensureVisibility();return;}
        try{window.__pmHistories=JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'))||{};}catch{}
        try{const saved=JSON.parse(localStorage.getItem('ST_SMS_CONFIG'));window.__pmConfig=saved||{apiUrl:'',apiKey:'',model:'',useIndependent:false};if(typeof window.__pmConfig.useIndependent==='undefined')window.__pmConfig.useIndependent=!!(window.__pmConfig.apiUrl&&window.__pmConfig.apiKey);}catch{window.__pmConfig={apiUrl:'',apiKey:'',model:'',useIndependent:false};}
        loadProfiles();loadBidirectional();loadTheme();loadBgSettings();loadGroups();migrateOldHistory();
        const c=getCtx(),defaultChar=c?.characters?.[c.characterId]?.name??'AI';

        phoneWindow=document.createElement('div');phoneWindow.id='pm-iphone';
        phoneWindow.dataset.layout=window.__pmTheme.layout||'standard';
        if(POPOVER_SUPPORTED)phoneWindow.setAttribute('popover','manual');
        phoneWindow.innerHTML=`
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn" style="justify-self:start;">☰</button>
    <div class="pm-name-wrap">
      <div class="pm-name">${escapeHtml(defaultChar)}</div>
      <span class="pm-grp-edit-btn" style="display:none;" onclick="window.__pmShowGroupCreate(currentPersona)">✏️</span>
    </div>
    <div class="pm-nav-right">
      <button onclick="window.__pmToggleSelect()" class="pm-nav-btn pm-trash-btn">🗑</button>
      <button onclick="window.__pmShowConfig()" class="pm-nav-btn">⚙</button>
      <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>
    </div>
  </div>
  <div class="pm-confirm-bar" style="display:none;"><span class="pm-confirm-tip">选择要删除的消息</span><button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">删除所选</button><button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">取消</button></div>
  <div class="pm-msg-list"></div>
  <div class="pm-input-bar"><input class="pm-input" placeholder="iMessage"><button onclick="window.__pmSend()" class="pm-up-btn">↑</button></div>
</div>`;
        document.body.appendChild(phoneWindow);
        if(phoneWindow.showPopover)try{phoneWindow.showPopover();}catch{}
        phoneActive=true;
        phoneWindow.querySelector('.pm-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.__pmSend();}});
        bindIsland(phoneWindow,phoneWindow.querySelector('.pm-island'));
        applyTheme();isGroupChat=false;groupMembers=[];groupColorMap={};groupDisplayName='';
        window.__pmSwitch(defaultChar);applyBidirectionalInjection();ensureVisibility();
    };

    // ══════ CSS ══════
    if(!document.getElementById('pm-css')){
        const s=document.createElement('style');s.id='pm-css';
        s.textContent=`
[popover]{border:none;padding:0;background:transparent;color:inherit;margin:0;overflow:visible;}
[popover]::backdrop{display:none;background:transparent;}
#pm-iphone{
    --pm-r-bg:#007aff;--pm-l-bg:#e9e9eb;--pm-r-txt:#fff;--pm-l-txt:#000;--pm-border:#1a1a1a;--pm-frost:0;
    position:fixed !important;inset:auto 40px 40px auto !important;margin:0 !important;transform:none !important;
    width:330px !important;height:580px !important;min-width:330px !important;max-width:330px !important;min-height:580px !important;max-height:580px !important;
    background:#fff !important;border:10px solid var(--pm-border) !important;border-radius:45px !important;z-index:2147483647 !important;
    display:flex !important;flex-direction:column !important;visibility:visible !important;opacity:1 !important;overflow:hidden !important;
    box-shadow:0 20px 60px rgba(0,0,0,.45) !important;transition:.35s cubic-bezier(.18,.89,.32,1.2);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif !important;
    touch-action:none;box-sizing:border-box !important;pointer-events:auto !important;filter:none !important;color:#000 !important;
}
#pm-iphone.is-min{inset:auto 40px 40px auto !important;height:50px !important;min-height:50px !important;max-height:50px !important;width:140px !important;min-width:140px !important;max-width:140px !important;border-radius:25px !important;border-width:6px !important;}
#pm-iphone.is-min .pm-main-ui{display:none !important;}
#pm-iphone *,#pm-iphone *::before,#pm-iphone *::after{box-sizing:border-box;}
.pm-island{width:100px;height:28px;background:#1a1a1a;margin:8px auto 4px;border-radius:14px;cursor:move;flex-shrink:0;touch-action:none;}
.pm-main-ui{flex:1 !important;display:flex !important;flex-direction:column !important;overflow:hidden;min-height:0;}
.pm-navbar{display:grid !important;grid-template-columns:auto 1fr auto;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f0;flex-shrink:0;}
.pm-name-wrap{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;overflow:hidden;}
.pm-name{font-weight:700 !important;color:#000 !important;font-size:15px !important;text-align:center !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.pm-grp-edit-btn{font-size:12px;cursor:pointer;flex-shrink:0;opacity:.6;transition:opacity .15s;}
.pm-grp-edit-btn:hover{opacity:1;}
.pm-nav-right{display:flex;gap:4px;justify-content:flex-end;}
#pm-iphone[data-layout="relaxed"] .pm-nav-right{gap:10px;}
#pm-iphone[data-layout="relaxed"] .pm-navbar{padding:8px 14px;}
.pm-nav-btn{background:none !important;border:none !important;font-size:18px !important;cursor:pointer;color:#007aff !important;padding:3px !important;line-height:1;flex-shrink:0;}
.pm-confirm-bar{background:#fff8f0;border-bottom:1px solid #ffe0b0;padding:7px 12px;align-items:center;gap:8px;flex-shrink:0;}
.pm-confirm-tip{flex:1;font-size:12px;color:#888;}.pm-confirm-btn{background:#ff3b30 !important;color:#fff !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600;}
.pm-cancel-btn{background:#f0f0f0 !important;color:#333 !important;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}
.pm-msg-list{flex:1 !important;overflow-y:auto !important;padding:12px !important;display:flex !important;flex-direction:column !important;gap:7px;background:#fff !important;min-height:0;background-size:cover !important;background-position:center !important;}
.pm-select-wrap{display:flex !important;align-items:flex-end;gap:6px;}
.pm-custom-check{width:20px;height:20px;border-radius:50%;border:2px solid #ccc;cursor:pointer;flex-shrink:0;margin-bottom:4px;transition:all .15s;position:relative;background:#fff !important;}
.pm-custom-check[data-checked="1"],.pm-custom-check.is-checked{border-color:#007aff;background:#007aff !important;}
.pm-custom-check[data-checked="1"]::after,.pm-custom-check.is-checked::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;}
.pm-bi-style{border-color:#e0a030;}.pm-bi-style.is-checked{border-color:#ff9500;background:#ff9500 !important;}
.pm-bubble{max-width:74% !important;padding:9px 13px;border-radius:18px !important;font-size:14px !important;line-height:1.45;word-break:break-word;animation:pm-pop .22s ease-out;}
.pm-bubble.pm-special{background:transparent !important;box-shadow:none !important;padding:0 !important;}
@keyframes pm-pop{from{opacity:0;transform:scale(.92) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
.pm-right{align-self:flex-end !important;background:var(--pm-r-bg) !important;color:var(--pm-r-txt) !important;border-bottom-right-radius:4px !important;}
.pm-left{align-self:flex-start !important;background:var(--pm-l-bg) !important;color:var(--pm-l-txt) !important;border-bottom-left-radius:4px !important;}
#pm-iphone[style*="--pm-frost: 1"] .pm-right,#pm-iphone[style*="--pm-frost: 1"] .pm-left{backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);}
.pm-group-bubble-wrap{align-self:flex-start;display:flex;flex-direction:column;gap:2px;max-width:78%;}
.pm-group-name{font-size:11px;color:#999;padding-left:6px;font-weight:500;}
.pm-group-bubble-wrap .pm-bubble{align-self:flex-start !important;}
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
.pm-voice-icon{font-size:14px;flex-shrink:0;}.pm-voice-wave{flex:1;display:flex;gap:3px;align-items:center;height:16px;min-width:20px;}
.pm-voice-wave i{display:inline-block;width:3px;background:currentColor;opacity:.7;border-radius:2px;animation:pm-wave 1s infinite ease-in-out;}
.pm-voice-wave i:nth-child(1){height:8px;}.pm-voice-wave i:nth-child(2){height:14px;animation-delay:.2s;}.pm-voice-wave i:nth-child(3){height:10px;animation-delay:.4s;}
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
.pm-modal-header b{font-size:16px !important;color:#000 !important;}.pm-modal-close{font-size:20px;color:#999;cursor:pointer;line-height:1;}
.pm-cfg-tabs{display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0;padding:0 14px;}
.pm-cfg-tab{flex:1;text-align:center;padding:10px 0;font-size:13px;font-weight:600;color:#888;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;user-select:none;}
.pm-cfg-tab:hover{color:#555;}.pm-cfg-tab-active{color:#007aff !important;border-bottom-color:#007aff !important;}
.pm-tab-pane{animation:pm-fade-in .15s ease;}
@keyframes pm-fade-in{from{opacity:0}to{opacity:1}}
.pm-bi-bar{padding:8px 14px;background:#fff8e8;border-bottom:1px solid #ffe6a8;font-size:11px;color:#885d00;display:flex;flex-direction:column;gap:3px;}
.pm-bi-tip{font-weight:600;color:#b87a00;}
.pm-modal-list{overflow-y:auto;flex:1;padding:6px 8px;max-height:400px;}
.pm-li{display:flex !important;align-items:center !important;gap:8px;padding:10px;border-radius:12px;}.pm-li:hover{background:#f5f5f5;}
.pm-grp-icon{font-size:16px;flex-shrink:0;}
.pm-li span{flex:1;font-size:14px !important;color:#007aff !important;font-weight:500;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-li i{font-style:normal;font-size:11px;color:#fff !important;background:#ff3b30 !important;padding:3px 9px;border-radius:8px;cursor:pointer;font-weight:600;flex-shrink:0;}
.pm-li-edit{background:#f0f0f3 !important;color:#555 !important;font-size:13px !important;padding:3px 6px !important;border-radius:6px !important;}
/* 联系人底部按钮 */
.pm-contact-bottom{padding:12px 14px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;flex-shrink:0;}
.pm-contact-btn{flex:1;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;font-family:inherit;text-align:center;}
.pm-contact-group{background:#ff9500 !important;color:#fff !important;}
.pm-contact-add{background:#007aff !important;color:#fff !important;}
.pm-modal-add{padding:12px 14px 16px;border-top:1px solid #f0f0f0;display:flex;flex-direction:column;gap:6px;flex-shrink:0;}
.pm-cfg-label{font-size:12px;color:#888;margin-bottom:-4px;}
.pm-cfg-input{width:100%;border:1px solid #ddd !important;border-radius:10px !important;padding:9px 12px;font-size:13px !important;outline:none;color:#000 !important;background:#fff !important;}
.pm-cfg-tip{font-size:11px;color:#aaa;text-align:center;padding:4px 0;}
.pm-mode-switch{display:flex !important;background:#f0f0f3;border-radius:12px;padding:3px;gap:3px;}
.pm-mode-opt{flex:1;text-align:center;padding:9px 0;font-size:13px;font-weight:600;color:#888;cursor:pointer;border-radius:9px;transition:all .2s;user-select:none;}
.pm-mode-opt:hover{color:#555;}.pm-mode-active{background:#fff !important;color:#007aff !important;box-shadow:0 2px 6px rgba(0,0,0,.08);}
.pm-prof-list{max-height:100px;overflow-y:auto;border:1px solid #eee;border-radius:10px;background:#fafafa;padding:4px;}
.pm-prof-li{display:flex !important;align-items:center !important;gap:8px;padding:7px 9px;border-radius:8px;}.pm-prof-li:hover{background:#fff;}
.pm-prof-info{flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;gap:2px;}
.pm-prof-url{font-size:12px;color:#007aff !important;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-meta{font-size:10px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-prof-del{font-style:normal;font-size:12px;color:#ff3b30;background:#fff !important;border:1px solid #ffd0cc;width:22px;height:22px;border-radius:50%;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer;flex-shrink:0;font-weight:600;}
.pm-prof-del:hover{background:#ff3b30 !important;color:#fff !important;}
.pm-prof-empty{text-align:center;color:#aaa;font-size:12px;padding:10px 0;}
.pm-theme-row{display:flex;gap:6px;flex-wrap:wrap;}
.pm-theme-chip{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-theme-chip:hover{background:#eee;}.pm-theme-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}
.pm-theme-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;}
.pm-custom-color-section{display:flex;flex-direction:column;gap:10px;margin-top:12px;}
.pm-custom-color-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pm-color-pick{width:32px;height:28px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;background:none;}
.pm-color-clear{background:none;border:1px solid #ddd;border-radius:6px;padding:3px 8px;font-size:11px;color:#888;cursor:pointer;white-space:nowrap;}.pm-color-clear:hover{background:#f0f0f0;}
.pm-layout-row{display:flex;gap:6px;}
.pm-layout-chip{padding:6px 16px;border-radius:16px;font-size:12px;color:#555;background:#f5f5f5;cursor:pointer;border:2px solid transparent;transition:all .15s;user-select:none;}
.pm-layout-chip:hover{background:#eee;}.pm-layout-active{border-color:#007aff;color:#007aff;background:#f0f7ff;}
.pm-bg-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.pm-bg-label{font-size:12px;color:#555;font-weight:500;min-width:60px;}
.pm-bg-btn{background:#f0f0f3;border:1px solid #ddd;border-radius:8px;padding:5px 10px;font-size:11px;color:#555;cursor:pointer;white-space:nowrap;font-family:inherit;display:inline-block;text-align:center;}
.pm-bg-btn:hover{background:#e5e5e8;}.pm-bg-del{color:#ff3b30 !important;border-color:#ffc8c8 !important;}
.pm-model-row{display:flex;gap:6px;}.pm-model-row .pm-cfg-input{flex:1;}
#pm-model-arrow{background:#f0f0f3;border:1px solid #ddd;border-radius:10px;width:38px;cursor:pointer;font-size:12px;color:#555;flex-shrink:0;transition:all .15s;}
#pm-model-arrow:hover{background:#007aff;color:#fff;border-color:#007aff;}
.pm-model-dropdown{position:fixed;z-index:2147483647;background:#fff !important;border:1px solid #ddd !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;display:flex;flex-direction:column;min-width:200px;padding:0 !important;margin:0 !important;color:#000 !important;}
.pm-model-search{border:none !important;border-bottom:1px solid #eee !important;padding:9px 12px !important;outline:none;font-size:13px !important;background:#fafafa !important;color:#000 !important;width:100%;}
.pm-model-options{overflow-y:auto;max-height:${MODEL_VISIBLE_ROWS*34}px;}
.pm-model-opt{padding:8px 12px;font-size:13px;color:#333;cursor:pointer;border-bottom:1px solid #f5f5f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:34px;line-height:18px;}
.pm-model-opt:hover{background:#f0f7ff;color:#007aff;}.pm-model-empty{padding:14px;text-align:center;font-size:12px;color:#999;}
/* 裁剪对话框 */
.pm-crop-overlay{position:fixed !important;inset:0 !important;margin:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;border:none !important;padding:0 !important;}
.pm-crop-dialog{background:#fff;border-radius:16px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:90vw;}
.pm-crop-title{font-size:15px;font-weight:600;color:#000;}
.pm-crop-container{position:relative;overflow:hidden;border-radius:12px;background:#000;touch-action:none;}
.pm-crop-img{position:absolute;top:0;left:0;transform-origin:0 0;max-width:none !important;pointer-events:none;user-select:none;}
.pm-crop-frame{position:absolute;top:0;left:0;border:2px dashed rgba(255,255,255,.5);border-radius:12px;pointer-events:none;}
.pm-crop-zoom{display:flex;align-items:center;gap:12px;}
.pm-crop-btn{background:#f0f0f3;border:1px solid #ddd;border-radius:8px;width:36px;height:36px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.pm-crop-scale{font-size:13px;color:#555;min-width:40px;text-align:center;}
.pm-crop-actions{display:flex;gap:8px;width:100%;}
.pm-crop-cancel{flex:1;background:#f0f0f3;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;color:#555;}
.pm-crop-confirm{flex:1;background:#007aff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;color:#fff;}
@media(max-width:500px),(max-height:700px){
    #pm-iphone{inset:0 !important;margin:auto !important;transform:none !important;width:min(330px,92vw) !important;height:min(560px,82vh) !important;height:min(560px,82dvh) !important;min-width:0 !important;min-height:0 !important;max-width:92vw !important;max-height:82vh !important;max-height:82dvh !important;border-width:8px !important;border-radius:36px !important;}
    #pm-iphone.is-min{inset:auto 20px 20px auto !important;margin:0 !important;transform:none !important;width:120px !important;min-width:120px !important;max-width:120px !important;height:44px !important;min-height:44px !important;max-height:44px !important;border-width:5px !important;border-radius:22px !important;}
    .pm-modal,.pm-modal-wide{width:min(320px,94vw) !important;max-height:90vh !important;max-height:90dvh !important;}
}
        `;
        document.head.appendChild(s);
    }

    function registerPhoneCommand(){const ctx=getCtx();if(!ctx)return false;const cb=()=>{try{window.__pmOpen();}catch(e){console.error('[phone-mode]',e);}return'';};try{const SCP=window.SlashCommandParser||ctx.SlashCommandParser,SC=window.SlashCommand||ctx.SlashCommand;if(SCP&&SC&&typeof SCP.addCommandObject==='function'&&typeof SC.fromProps==='function'){SCP.addCommandObject(SC.fromProps({name:'phone',callback:cb,helpString:'打开短信'}));return true;}}catch{}try{if(typeof ctx.registerSlashCommand==='function'){ctx.registerSlashCommand('phone',cb,[],'打开短信',true,true);return true;}}catch{}return false;}
    if(!registerPhoneCommand()){let t=0;const i=setInterval(()=>{t++;if(registerPhoneCommand()||t>=30)clearInterval(i);},500);}
    document.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.shiftKey)return;const ta=document.getElementById('send_textarea');if(!ta||document.activeElement!==ta)return;if(ta.value.trim()==='/phone'){e.preventDefault();e.stopImmediatePropagation();ta.value='';window.__pmOpen();}},true);
    document.addEventListener('click',e=>{const btn=e.target.closest?.('#send_but');if(!btn)return;const ta=document.getElementById('send_textarea');if(!ta)return;if(ta.value.trim()==='/phone'){e.preventDefault();e.stopImmediatePropagation();ta.value='';window.__pmOpen();}},true);

    try{window.__pmHistories=JSON.parse(localStorage.getItem('ST_SMS_DATA_V2'))||{};}catch{}
    loadBidirectional();loadGroups();
    setTimeout(()=>{migrateOldHistory();applyBidirectionalInjection();},1500);
    console.log('[phone-mode] v5.1 loaded');
})();
