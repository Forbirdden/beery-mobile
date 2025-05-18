document.addEventListener('DOMContentLoaded', () => {
    const APPS_PER_PAGE = 50;
    const CACHE_TIME = 5 * 60 * 1000;
    const GITHUB_TOKEN_KEY = 'github_token';
    const THEME_KEY = 'preferred_theme';
    let cache = {};
    let allApps = [];
    let currentPage = 1;
    let currentSearch = '';

    // Theme functions
    function toggleTheme() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem(THEME_KEY, document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    }

    function applySavedTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
        document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }

    function getAuthHeader() {
        const token = localStorage.getItem(GITHUB_TOKEN_KEY);
        return token ? { 'Authorization': `token ${token}` } : {};
    }

    function updateAuthUI() {
        const authButton = document.getElementById('authButton');
        const hasToken = localStorage.getItem(GITHUB_TOKEN_KEY);
        authButton.textContent = hasToken ? 'Logout' : 'Login with GitHub';
        authButton.className = hasToken ? 'btn btn-outline-danger' : 'btn btn-outline-dark';
    }

    async function cachedFetch(url) {
        const now = Date.now();
        if (cache[url] && now - cache[url].timestamp < CACHE_TIME) {
            return cache[url].data;
        }

        try {
            const res = await fetch(url, {
                headers: { 
                    'User-Agent': 'GitHub-App-Store',
                    ...getAuthHeader()
                }
            });

            if (!res.ok) {
                if (res.status === 401) handleAuthError();
                if (res.status === 403) showError('GitHub API rate limit exceeded');
                return null;
            }

            const data = await res.json();
            cache[url] = { data, timestamp: now };
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            return null;
        }
    }

    function handleAuthError() {
        localStorage.removeItem(GITHUB_TOKEN_KEY);
        updateAuthUI();
        showError('Invalid token. Please re-authenticate.');
        new bootstrap.Modal(document.getElementById('tokenModal')).show();
    }

    async function loadAppData(repoEntry) {
        if (!repoEntry.owner || !repoEntry.repo) {
            console.error('Invalid repo entry:', repoEntry);
            return null;
        }

        try {
            const [releases, repoInfo] = await Promise.all([
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}/releases`),
                cachedFetch(`https://api.github.com/repos/${repoEntry.owner}/${repoEntry.repo}`)
            ]);

            return {
                title: repoEntry.display_name || repoEntry.repo,
                originalRepo: repoEntry.repo,
                author: repoEntry.owner,
                description: repoInfo?.description || 'No description available',
                stars: repoInfo?.stargazers_count || 0,
                releases: releases || [],
                icon: repoEntry.icon || 'logo1x1.png',
                os_overrides: repoEntry.os_overrides || {}
            };
        } catch (error) {
            console.error(`Error loading ${repoEntry.owner}/${repoEntry.repo}:`, error);
            return null;
        }
    }

    function sortApps(apps) {
        return apps.sort((a, b) => {
            if (b.stars !== a.stars) return b.stars - a.stars;
            if (a.title !== b.title) return a.title.localeCompare(b.title);
            return a.author.localeCompare(b.author);
        });
    }

    function createAppCard(app) {
        return `
            <div class="col mb-4" 
                 data-search="${app.title.toLowerCase()} 
                 ${app.originalRepo.toLowerCase()} 
                 ${app.author.toLowerCase()} 
                 ${app.description.toLowerCase()}">
                <div class="card h-100 shadow-sm">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex align-items-center mb-3">
                            <img src="${app.icon}" 
                                 class="app-icon rounded me-3" 
                                 alt="${app.title} icon"
                                 onerror="this.src='logo1x1.png'">
                            <div>
                                <h5 class="card-title mb-0">${app.title}</h5>
                                <div class="d-flex align-items-center gap-2 mt-1">
                                    <small class="text-muted">by ${app.author}</small>
                                </div>
                            </div>
                        </div>
                        <p class="card-text flex-grow-1">${app.description}</p>
                        <div class="d-flex justify-content-between align-items-center mt-auto">
                            <button class="btn btn-primary download-btn"
                                data-repo="${app.author}/${app.originalRepo}">
                                Download
                            </button>
                            <a href="https://github.com/${app.author}/${app.originalRepo}" 
                               target="_blank" 
                               class="source-link">
                                Source
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderApps() {
        const appsContainer = document.getElementById('apps');
        const filteredApps = allApps.filter(app => 
            app.title.toLowerCase().includes(currentSearch) ||
            app.originalRepo.toLowerCase().includes(currentSearch) ||
            app.author.toLowerCase().includes(currentSearch) ||
            app.description.toLowerCase().includes(currentSearch)
        );

        const startIndex = (currentPage - 1) * APPS_PER_PAGE;
        const endIndex = startIndex + APPS_PER_PAGE;
        
        appsContainer.innerHTML = filteredApps
            .slice(0, endIndex)
            .map(createAppCard)
            .join('');

        const loadMoreBtn = document.getElementById('loadMore');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = endIndex >= filteredApps.length ? 'none' : 'block';
            loadMoreBtn.onclick = () => {
                currentPage++;
                renderApps();
            };
        }

        document.getElementById('status').textContent = 
            `Showing ${Math.min(endIndex, filteredApps.length)} of ${filteredApps.length} apps`;
    }

    function showDownloadModal(repoPath) {
        const modal = document.getElementById('downloadModal');
        const modalBody = modal.querySelector('.modal-body');
        const app = allApps.find(a => `${a.author}/${a.originalRepo}` === repoPath);

        if (!app) return;

        modalBody.innerHTML = `
            <div class="version-selector">
                <h5 class="mb-3">${app.title}</h5>
                <select class="form-select mb-4 version-select">
                    ${app.releases.map(r => `<option>${r.tag_name}</option>`).join('')}
                </select>
                <div class="os-options"></div>
            </div>
        `;

        const updateOptions = () => {
            const version = modal.querySelector('.version-select').value;
            const release = app.releases.find(r => r.tag_name === version);
            const options = processAssets(release?.assets || [], app.os_overrides);
            
            modal.querySelector('.os-options').innerHTML = options
                .map(({ os, ext, url, size }) => `
                    <div class="download-option mb-2">
                        <button class="btn btn-outline-dark w-100 text-start"
                            onclick="window.open('${url}', '_blank')">
                            <span class="badge bg-primary me-2">${os}</span>
                            .${ext} (${formatBytes(size)})
                        </button>
                    </div>
                `).join('') || '<div class="text-muted">No available downloads</div>';
        };

        modal.querySelector('.version-select').addEventListener('change', updateOptions);
        updateOptions();
        new bootstrap.Modal(modal).show();
    }

    function processAssets(assets, osOverrides) {
        const seen = new Set();
        return assets
            .map(asset => {
                const ext = asset.name.split('.').pop().toLowerCase();
                if (['blockmap', 'yml', 'sha', 'sig', 'asc', 'txt', 'zsync', 'sym'].includes(ext)) return null;

                let os = Object.entries(osOverrides).find(([key]) => 
                    asset.name.toLowerCase().includes(key.toLowerCase())
                )?.[1];

                if (!os) {
                    const lowerName = asset.name.toLowerCase();
                    if (lowerName.includes('linux') || lowerName.includes('lin')) os = 'LINUX';
                    else if (lowerName.includes('win') || lowerName.includes('windows')) os = 'WINDOWS';
                    else if (lowerName.includes('mac') || lowerName.includes('osx') || lowerName.includes('darwin')) os = 'MACOS';
                    else if (['exe', 'msi', 'msix', 'appinstaller'].includes(ext)) os = 'WINDOWS';
                    else if (['dmg', 'pkg'].includes(ext)) os = 'MACOS';
                    else if (['deb', 'appimage', 'rpm', 'flatpak'].includes(ext)) os = 'LINUX';
                }

                const key = `${os}-${ext}`.toUpperCase();
                return os && !seen.has(key) ? (seen.add(key), {
                    os: os.toUpperCase(),
                    ext: ext.toUpperCase(),
                    url: asset.browser_download_url,
                    size: asset.size
                }) : null;
            })
            .filter(Boolean);
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) bytes /= 1024, i++;
        return `${bytes.toFixed(1)} ${units[i]}`;
    }

    function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => errorDiv.style.display = 'none', 5000);
    }

    async function init() {
        try {
            applySavedTheme();
            document.getElementById('themeToggle').addEventListener('click', toggleTheme);

            const repos = await fetch('repos.json').then(res => res.json());
            const loadedApps = (await Promise.all(repos.repos.map(loadAppData))).filter(app => app);
            allApps = sortApps(loadedApps);
            
            document.getElementById('searchInput').addEventListener('input', e => {
                currentSearch = e.target.value.trim().toLowerCase();
                currentPage = 1;
                renderApps();
            });

            document.getElementById('apps').addEventListener('click', e => {
                if (e.target.closest('.download-btn')) {
                    const repoPath = e.target.closest('.download-btn').dataset.repo;
                    showDownloadModal(repoPath);
                }
            });

            document.getElementById('authButton').addEventListener('click', () => {
                if(localStorage.getItem(GITHUB_TOKEN_KEY)) {
                    localStorage.removeItem(GITHUB_TOKEN_KEY);
                    updateAuthUI();
                    showError('Logged out successfully');
                    location.reload(); 
                } else {
                    new bootstrap.Modal(document.getElementById('tokenModal')).show();
                }
            });

            document.getElementById('saveToken').addEventListener('click', () => {
                const token = document.getElementById('tokenInput').value.trim();
                if(/^ghp_[a-zA-Z0-9]{36}$/.test(token)) {
                    localStorage.setItem(GITHUB_TOKEN_KEY, token);
                    document.getElementById('tokenInput').classList.remove('is-invalid');
                    new bootstrap.Modal(document.getElementById('tokenModal')).hide();
                    updateAuthUI();
                    location.reload(); 
                } else {
                    document.getElementById('tokenInput').classList.add('is-invalid');
                }
            });
            
            if (!localStorage.getItem(GITHUB_TOKEN_KEY)) {
                const reminderModal = new bootstrap.Modal(document.getElementById('loginReminderModal'));
                reminderModal.show();
            }
    
            updateAuthUI();
            renderApps();
        } catch (error) {
            showError('Failed to load application data');
            console.error('Initialization error:', error);
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        .star-count {
            background: rgba(255, 215, 0, 0.1);
            color: #ffd700;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.9rem;
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }
        .star-count::before {
            content: '★';
            font-size: 0.8em;
        }
        .app-icon {
            width: 64px;
            height: 64px;
            object-fit: contain;
        }
        .source-link {
            color: var(--text-color) !important;
            text-decoration: none !important;
            font-weight: 600;
            padding: 8px 0;
            transition: opacity 0.2s;
        }
        .source-link:hover {
            opacity: 0.8;
        }
    `;
    document.head.appendChild(style);

    init();
});