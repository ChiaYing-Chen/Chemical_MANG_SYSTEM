(function () {
  // ==========================================
  // 統一頁首組件腳本 (Unified Header Script)
  // Namespace: unified
  // ==========================================

  // SVG 圖示代碼庫 (避免依賴外部 Lucide 庫)
  const SVG_ICONS = {
    launcher: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
    FileText: `<svg viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
    Activity: `<svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    Calculator: `<svg viewBox="0 0 24 24"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>`,
    Droplets: `<svg viewBox="0 0 24 24"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.09 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M17 18.5c1.37 0 2.5-1.14 2.5-2.53 0-.72-.35-1.41-1.07-2s-1.43-1.42-1.61-2.33c-.18.91-.71 1.77-1.43 2.35s-1.39 1.09-1.39 1.81c0 1.39 1.13 2.53 2.5 2.53z"/></svg>`,
    ClipboardList: `<svg viewBox="0 0 24 24"><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M16 2H8v4h8z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`,
    Edit: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    ChevronDown: `<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
    Alert: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`
  };

  // 全域變數狀態
  let currentUser = {
    username: '匿名',
    isAuthenticated: false,
    source: 'LocalStorage',
    debug: {}
  };
  
  let appList = [];

  // 輔助函式：產生漸變色
  function getGradientStyle(name) {
    if (!name || name === '匿名') {
      return 'linear-gradient(135deg, #64748b 0%, #475569 100%)'; // 灰色
    }
    const colors = [
      ['#4f46e5', '#818cf8'], // 藍靛
      ['#0ea5e9', '#38bdf8'], // 天藍
      ['#10b981', '#34d399'], // 綠色
      ['#f59e0b', '#fbbf24'], // 橙黃
      ['#d946ef', '#f472b6'], // 洋紅
      ['#84cc16', '#a3e635'], // 萊姆綠
      ['#06b6d4', '#22d3ee']  // 青色
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return `linear-gradient(135deg, ${colors[index][0]} 0%, ${colors[index][1]} 100%)`;
  }

  // 輔助函式：取得名稱首字
  function getAvatarChar(name) {
    if (!name || name === '匿名') return '👻';
    // 取最後一個字或第一個英文字母
    const trimmed = name.trim();
    if (/^[A-Za-z]/.test(trimmed)) {
      return trimmed[0].toUpperCase();
    }
    return trimmed[trimmed.length - 1];
  }

  // 核心邏輯：探測 AD 身份
  async function probeIdentity() {
    const urls = [
      '/PIMCP/whoami.aspx',
      '/PIMCP/public/whoami.aspx',
      './whoami.aspx'
    ];

    for (let url of urls) {
      try {
        const res = await fetch(`${url}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.username && data.username !== '匿名') {
            currentUser = {
              username: data.username,
              isAuthenticated: true,
              source: data.source || 'IIS NTLM',
              debug: data.debug || {}
            };
            // 同步寫入 LocalStorage，以相容各 App 內部原有邏輯
            localStorage.setItem('unified_user_name', data.username);
            localStorage.setItem('pages_manual_user', data.username);
            localStorage.setItem('appUserName', data.username);
            return;
          }
        }
      } catch (e) {
        // 繼續嘗試下一個 URL
      }
    }

    // 探測失敗，讀取 LocalStorage 緩存
    const savedName = localStorage.getItem('unified_user_name') || 
                      localStorage.getItem('pages_manual_user') || 
                      localStorage.getItem('appUserName');
    if (savedName && savedName !== '匿名') {
      currentUser = {
        username: savedName,
        isAuthenticated: false,
        source: 'LocalStorage 緩存',
        debug: { note: 'NTLM 探測失敗，載入先前手動設定' }
      };
    }
  }

  // 核心邏輯：載入 App 清單
  async function loadApps() {
    try {
      const res = await fetch('/PIMCP/header/apps.json');
      if (res.ok) {
        appList = await res.json();
      }
    } catch (e) {
      console.warn('[Unified Header] apps.json 載入失敗，使用預設 App 列表', e);
      appList = [
        { id: 'pages', name: '文件協作平台', description: '團隊知識庫與文件協作', url: '/Pages/', gradient: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)', icon: 'FileText' },
        { id: 'pimcp', name: 'PI 監控平台', description: 'PI 數據監控與診斷', url: '/PIMCP/', gradient: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)', icon: 'Activity' },
        { id: 'condensor', name: '冷凝器熱力計算', description: '冷凝器運轉熱效率分析', url: '/Condensor/', gradient: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)', icon: 'Calculator' },
        { id: 'wtca', name: '藥劑水質管理', description: '加藥與水質監控管理', url: '/WTCA/', gradient: 'linear-gradient(135deg, #10b981 0%, #84cc16 100%)', icon: 'Droplets' },
        { id: 'eucdb', name: '工單資料儀表板', description: '維護工單與統計視覺化', url: '/eucDB/', gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)', icon: 'ClipboardList' }
      ];
    }
  }

  // 頁首渲染與掛載
  function renderComponents() {
    // 1. 渲染 App Launcher (九宮格)
    const launcherContainer = document.getElementById('unified-app-launcher');
    if (launcherContainer) {
      launcherContainer.innerHTML = `
        <button class="unified-btn" id="unified-launcher-trigger" title="切換系統">
          ${SVG_ICONS.launcher}
        </button>
      `;
    }

    // 2. 渲染 User Profile Avatar (頭像)
    const avatarContainer = document.getElementById('unified-user-avatar');
    if (avatarContainer) {
      const char = getAvatarChar(currentUser.username);
      const gradient = getGradientStyle(currentUser.username);
      const authClass = currentUser.isAuthenticated ? 'active-auth' : '';
      
      avatarContainer.innerHTML = `
        <div class="unified-avatar-btn ${authClass}" id="unified-avatar-trigger" style="background: ${gradient}" title="目前使用者: ${currentUser.username}">
          ${char}
        </div>
      `;
    }

    // 重新繫結事件
    bindEvents();
  }

  // 建立與掛載 Popovers (直接掛在 body 上，以避開父容器裁切)
  function createPopovers() {
    // 移除舊的 popovers 避免重複建立
    const oldLauncher = document.getElementById('unified-popover-launcher');
    if (oldLauncher) oldLauncher.remove();
    const oldUser = document.getElementById('unified-popover-user');
    if (oldUser) oldUser.remove();
    const oldModal = document.getElementById('unified-modal-username');
    if (oldModal) oldModal.remove();

    // A. App 啟動器彈窗
    const launcherHtml = `
      <div class="unified-popover unified-launcher-popover" id="unified-popover-launcher">
        <div class="unified-popover-title">
          ${SVG_ICONS.launcher}
          <span>系統切換啟動器</span>
        </div>
        <div class="unified-app-grid" id="unified-app-grid-content">
          <!-- 動態插入 App 卡片 -->
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', launcherHtml);

    // 渲染 App 卡片內容
    const gridContent = document.getElementById('unified-app-grid-content');
    if (gridContent) {
      gridContent.innerHTML = appList.map(app => `
        <a class="unified-app-card" href="${app.url}" title="開啟 ${app.name}">
          <div class="unified-app-icon-wrapper" style="background: ${app.gradient}; color: #ffffff">
            ${SVG_ICONS[app.icon] || SVG_ICONS.FileText}
          </div>
          <span class="unified-app-name">${app.name}</span>
          <span class="unified-app-desc">${app.description}</span>
        </a>
      `).join('');
    }

    // B. 使用者資訊彈窗
    const char = getAvatarChar(currentUser.username);
    const gradient = getGradientStyle(currentUser.username);
    const authText = currentUser.isAuthenticated ? 'Windows AD 驗證' : '本機設定';
    const sourceText = currentUser.source || 'LocalStorage';
    
    const userHtml = `
      <div class="unified-popover unified-user-popover" id="unified-popover-user">
        <div class="unified-user-info-box">
          <div class="unified-user-popover-avatar" style="background: ${gradient}">
            ${char}
          </div>
          <div class="unified-user-detail">
            <span class="unified-user-name">${currentUser.username}</span>
            <span class="unified-user-role">${authText}</span>
          </div>
        </div>
        <div class="unified-user-meta">
          <div class="unified-user-meta-item">
            <span>驗證來源</span>
            <span>${sourceText}</span>
          </div>
        </div>
        <button class="unified-user-action-btn" id="unified-edit-username-btn">
          ${SVG_ICONS.Edit}
          <span>修改顯示稱呼</span>
        </button>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', userHtml);

    // C. 姓名修改 Modal 對話框
    const modalHtml = `
      <div class="unified-modal-overlay" id="unified-modal-username">
        <div class="unified-modal-box">
          <div class="unified-modal-title">✏️ 修改顯示稱呼</div>
          <div class="unified-modal-desc">
            目前偵測為匿名或本地開發，您可以手動設定您的名稱，以方便在系統中進行標示。
          </div>
          <input type="text" class="unified-modal-input" id="unified-modal-username-input" 
            placeholder="請輸入您的稱呼 (例如：王大明)" value="${currentUser.username === '匿名' ? '' : currentUser.username}">
          <div class="unified-modal-actions">
            <button class="unified-modal-btn" id="unified-modal-cancel">取消</button>
            <button class="unified-modal-btn unified-modal-btn-primary" id="unified-modal-save">儲存</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  // 事件繫結邏輯
  function bindEvents() {
    const launcherTrigger = document.getElementById('unified-launcher-trigger');
    const avatarTrigger = document.getElementById('unified-avatar-trigger');
    const popoverLauncher = document.getElementById('unified-popover-launcher');
    const popoverUser = document.getElementById('unified-popover-user');
    
    const editBtn = document.getElementById('unified-edit-username-btn');
    const modalOverlay = document.getElementById('unified-modal-username');
    const modalInput = document.getElementById('unified-modal-username-input');
    const modalCancel = document.getElementById('unified-modal-cancel');
    const modalSave = document.getElementById('unified-modal-save');

    // 下拉定位函數
    function positionPopover(trigger, popover) {
      if (!trigger || !popover) return;
      const rect = trigger.getBoundingClientRect();
      const popoverWidth = popover.offsetWidth || 300;
      
      // 計算 top/left，掛載在 body 上
      let top = rect.bottom + window.scrollY + 8;
      let left = rect.left + window.scrollX + rect.width - popoverWidth;
      
      // 邊界防護：避免彈窗被切出螢幕左側
      if (left < 10) left = 10;
      
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    }

    // 點擊顯示 App Launcher Popover
    if (launcherTrigger && popoverLauncher) {
      launcherTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        popoverUser.classList.remove('show');
        popoverLauncher.classList.toggle('show');
        if (popoverLauncher.classList.contains('show')) {
          positionPopover(launcherTrigger, popoverLauncher);
        }
      });
    }

    // 點擊顯示 User Popover
    if (avatarTrigger && popoverUser) {
      avatarTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        popoverLauncher.classList.remove('show');
        popoverUser.classList.toggle('show');
        if (popoverUser.classList.contains('show')) {
          positionPopover(avatarTrigger, popoverUser);
        }
      });
    }

    // 點擊開啟修改姓名 Modal
    if (editBtn && modalOverlay) {
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        popoverUser.classList.remove('show');
        modalOverlay.classList.add('show');
        if (modalInput) {
          modalInput.value = currentUser.username === '匿名' ? '' : currentUser.username;
          modalInput.focus();
        }
      });
    }

    // 取消 Modal
    if (modalCancel && modalOverlay) {
      modalCancel.addEventListener('click', function () {
        modalOverlay.classList.remove('show');
      });
    }

    // 儲存姓名
    if (modalSave && modalOverlay && modalInput) {
      modalSave.addEventListener('click', function () {
        const val = modalInput.value.trim();
        if (val) {
          currentUser.username = val;
          currentUser.isAuthenticated = false; // 手動更改設為 false
          currentUser.source = '手動設定';
          
          // 寫入 localStorage 進行全專案同步
          localStorage.setItem('unified_user_name', val);
          localStorage.setItem('pages_manual_user', val);
          localStorage.setItem('appUserName', val);

          // 重新生成 popovers 與重新渲染
          createPopovers();
          renderComponents();
          
          modalOverlay.classList.remove('show');

          // 發送全域變更事件，讓各 App 的 React 頁面能即時獲取最新姓名並重繪
          const event = new CustomEvent('unified-user-changed', { detail: { username: val } });
          window.dispatchEvent(event);
        }
      });

      // 支援 Enter 儲存
      modalInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          modalSave.click();
        }
        if (e.key === 'Escape') {
          modalCancel.click();
        }
      });
    }

    // 點擊外部關閉彈窗
    document.addEventListener('click', function (e) {
      const target = e.target;
      if (popoverLauncher && !popoverLauncher.contains(target) && target !== launcherTrigger) {
        popoverLauncher.classList.remove('show');
      }
      if (popoverUser && !popoverUser.contains(target) && target !== avatarTrigger) {
        popoverUser.classList.remove('show');
      }
    });

    // 視窗滾動或縮放時重新調整 Popovers 位置
    window.addEventListener('resize', function () {
      if (popoverLauncher && popoverLauncher.classList.contains('show')) {
        positionPopover(launcherTrigger, popoverLauncher);
      }
      if (popoverUser && popoverUser.classList.contains('show')) {
        positionPopover(avatarTrigger, popoverUser);
      }
    });
  }

  // 初始化流程
  async function init() {
    // 1. 探測身分與載入 Apps 設定
    await Promise.all([probeIdentity(), loadApps()]);

    // 2. 建立掛載在 body 的 Popovers
    createPopovers();

    // 3. 渲染與掛載按鈕
    renderComponents();
  }

  // 確保 DOM 準備就緒後執行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
