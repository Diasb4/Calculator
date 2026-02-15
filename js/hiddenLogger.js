(function () {
    "use strict";

    var STORAGE_KEY = "gm_hidden_log_v1";
    var DISABLE_KEY = "gm_hidden_log_disabled";
    var UID_KEY = "gm_hidden_uid_v1";
    var REMOTE_DISABLE_KEY = "gm_hidden_remote_disabled";
    var MAX_ENTRIES = 200;
    var MAX_REMOTE_QUEUE = 25;
    var REMOTE_FLUSH_MS = 5000;
    var REMOTE_MAX_EVENTS_PER_FLUSH = 10;

    function nowIso() {
        try {
            return new Date().toISOString();
        } catch (_) {
            return String(Date.now());
        }
    }

    function safeString(value, maxLen) {
        try {
            if (value === undefined || value === null) return "";
            var s = String(value);
            if (maxLen && s.length > maxLen) return s.slice(0, maxLen) + "…";
            return s;
        } catch (_) {
            return "";
        }
    }

    function safeJson(value) {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return "{}";
        }
    }

    function escapeHtml(s) {
        return safeString(s, 4000)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function getPathNoQuery(urlLike) {
        try {
            var u = new URL(urlLike, window.location.origin);
            return u.pathname || "/";
        } catch (_) {
            try {
                return window.location && window.location.pathname ? window.location.pathname : "/";
            } catch (__){
                return "/";
            }
        }
    }

    function readLog() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function writeLog(entries) {
        try {
            localStorage.setItem(STORAGE_KEY, safeJson(entries));
        } catch (_) {
            // ignore
        }
    }

    function isDisabled() {
        try {
            return localStorage.getItem(DISABLE_KEY) === "1";
        } catch (_) {
            return false;
        }
    }

    function isRemoteDisabled() {
        try {
            return localStorage.getItem(REMOTE_DISABLE_KEY) === "1";
        } catch (_) {
            return false;
        }
    }

    function randomId() {
        try {
            var a = new Uint32Array(3);
            crypto.getRandomValues(a);
            return (
                a[0].toString(16).padStart(8, "0") +
                a[1].toString(16).padStart(8, "0") +
                a[2].toString(16).padStart(8, "0")
            );
        } catch (_) {
            return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
        }
    }

    function getOrCreateUid() {
        try {
            var existing = localStorage.getItem(UID_KEY);
            if (existing) return existing;
            var uid = randomId();
            localStorage.setItem(UID_KEY, uid);
            return uid;
        } catch (_) {
            return "unknown";
        }
    }

    function addEntry(entry) {
        if (isDisabled()) return;

        var entries = readLog();
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
            entries = entries.slice(entries.length - MAX_ENTRIES);
        }
        writeLog(entries);
    }

    function baseEntry(kind, name, data) {
        return {
            ts: nowIso(),
            kind: safeString(kind, 32),
            name: safeString(name, 64),
            path: getPathNoQuery(window.location && window.location.href ? window.location.href : ""),
            data: data && typeof data === "object" ? data : {},
        };
    }

    var api = {
        event: function (name, data) {
            addEntry(baseEntry("event", name, data || {}));
        },
        error: function (name, data) {
            addEntry(baseEntry("error", name, data || {}));
        },
        dump: function () {
            return readLog();
        },
        dumpJson: function () {
            return safeJson(readLog());
        },
        clear: function () {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (_) {
                // ignore
            }
        },
        disable: function () {
            try {
                localStorage.setItem(DISABLE_KEY, "1");
            } catch (_) {
                // ignore
            }
        },
        enable: function () {
            try {
                localStorage.removeItem(DISABLE_KEY);
            } catch (_) {
                // ignore
            }
        },
        remoteDisable: function () {
            try {
                localStorage.setItem(REMOTE_DISABLE_KEY, "1");
            } catch (_) {
                // ignore
            }
        },
        remoteEnable: function () {
            try {
                localStorage.removeItem(REMOTE_DISABLE_KEY);
            } catch (_) {
                // ignore
            }
        },
    };

    try {
        Object.defineProperty(window, "__gmLog", {
            value: api,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    } catch (_) {
        window.__gmLog = api;
    }

    // Basic page view
    api.event("page_view", {
        ref: safeString(document && document.referrer ? getPathNoQuery(document.referrer) : "", 200),
        ua: safeString(navigator && navigator.userAgent ? navigator.userAgent : "", 200),
    });

    // Remote (Telegram) batching
    var remoteQueue = [];
    var remoteTimer = null;

    function enqueueRemote(evt) {
        if (isRemoteDisabled()) return;
        if (!evt) return;

        remoteQueue.push(evt);
        if (remoteQueue.length > MAX_REMOTE_QUEUE) {
            remoteQueue = remoteQueue.slice(remoteQueue.length - MAX_REMOTE_QUEUE);
        }

        if (!remoteTimer) {
            remoteTimer = setTimeout(flushRemote, REMOTE_FLUSH_MS);
        }

        if (remoteQueue.length >= REMOTE_MAX_EVENTS_PER_FLUSH) {
            flushRemote();
        }
    }

    function flushRemote() {
        try {
            if (remoteTimer) {
                clearTimeout(remoteTimer);
                remoteTimer = null;
            }
            if (isRemoteDisabled()) return;
            if (!remoteQueue.length) return;

            var batch = remoteQueue.splice(0, REMOTE_MAX_EVENTS_PER_FLUSH);
            var payload = {
                weblog: {
                    uid: getOrCreateUid(),
                    path: getPathNoQuery(window.location && window.location.href ? window.location.href : ""),
                    ts: nowIso(),
                    events: batch,
                },
            };

            // Use relative path so it works on the deployed domain and locally.
            fetch("/api/telegram", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: safeJson(payload),
                keepalive: true,
            }).catch(function () {
                // ignore network failures
            });
        } catch (_) {
            // ignore
        }
    }

    // JS errors
    window.addEventListener("error", function (e) {
        try {
            api.error("window_error", {
                msg: safeString(e && e.message ? e.message : "", 300),
                src: safeString(e && e.filename ? e.filename : "", 200),
                line: e && typeof e.lineno === "number" ? e.lineno : null,
                col: e && typeof e.colno === "number" ? e.colno : null,
                stack: safeString(e && e.error && e.error.stack ? e.error.stack : "", 800),
            });
        } catch (_) {
            // ignore
        }
    });

    window.addEventListener("unhandledrejection", function (e) {
        try {
            var reason = e && e.reason ? e.reason : null;
            api.error("unhandledrejection", {
                reason: safeString(reason && reason.message ? reason.message : reason, 400),
                stack: safeString(reason && reason.stack ? reason.stack : "", 800),
            });
        } catch (_) {
            // ignore
        }
    });

    // Click tracking (no querystring / no form values)
    document.addEventListener(
        "click",
        function (e) {
            try {
                var el = e && e.target ? e.target : null;
                if (!el) return;

                // walk up a bit to find something meaningful
                var depth = 0;
                while (el && depth < 3) {
                    if (el.tagName === "A" || el.tagName === "BUTTON") break;
                    el = el.parentElement;
                    depth++;
                }
                if (!el || !el.tagName) return;
                if (el.tagName !== "A" && el.tagName !== "BUTTON") return;

                var href = "";
                if (el.tagName === "A") {
                    href = safeString(el.getAttribute("href") || "", 300);
                    if (href) href = getPathNoQuery(href);
                }

                api.event("click", {
                    tag: el.tagName.toLowerCase(),
                    id: safeString(el.id || "", 80),
                    cls: safeString(el.className || "", 120),
                    text: safeString(el.innerText || el.textContent || "", 120),
                    href: href,
                });

                enqueueRemote({
                    type: "click",
                    tag: safeString(el.tagName.toLowerCase(), 16),
                    id: safeString(el.id || "", 80),
                    cls: safeString(el.className || "", 120),
                    text: safeString(el.innerText || el.textContent || "", 120),
                    href: href,
                });
            } catch (_) {
                // ignore
            }
        },
        true
    );

    // Hidden dev shortcut: Ctrl+Alt+Shift+L -> prompt with JSON dump
    document.addEventListener("keydown", function (e) {
        try {
            if (!e) return;
            var key = (e.key || "").toLowerCase();
            if (key !== "l") return;
            if (!(e.ctrlKey && e.altKey && e.shiftKey)) return;

            var dump = api.dumpJson();
            api.event("dev_dump", { bytes: dump.length });
            // Using prompt because it works without any UI dependencies.
            window.prompt("GradeMaster hidden log (JSON):", dump);
        } catch (_) {
            // ignore
        }
    });

    // Expose uid for debugging (non-enumerable via __gmLog anyway)
    api.event("uid", { uid: getOrCreateUid() });
})();
