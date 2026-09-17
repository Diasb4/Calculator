// js/analytics.js
// Anonymous, zero-PII client telemetry for GradeMaster
(function () {
    'use strict';

    function getAnonId() {
        try {
            let id = localStorage.getItem('gm_anon_id');
            if (!id || typeof id !== 'string' || id.length < 5) {
                id = 'w_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
                localStorage.setItem('gm_anon_id', id);
            }
            return id;
        } catch {
            return 'w_temp_' + Math.random().toString(36).slice(2, 8);
        }
    }

    function sendEvent(type, calcType) {
        try {
            const anonId = getAnonId();
            const payload = JSON.stringify({
                anonId: anonId,
                type: type,
                calcType: calcType,
                platform: 'web'
            });

            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon('/api/stats', blob);
            } else if (window.fetch) {
                fetch('/api/stats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true
                }).catch(function () {});
            }
        } catch (_) {
            // Failsafe: never break calculator functionality
        }
    }

    // Record visit once per session
    try {
        var todayKey = 'gm_visit_' + new Date().toISOString().slice(0, 10);
        if (typeof sessionStorage !== 'undefined' && sessionStorage) {
            if (!sessionStorage.getItem(todayKey)) {
                sessionStorage.setItem(todayKey, '1');
                sendEvent('visit');
            }
        }
    } catch (_) {
        // Failsafe in restricted environments
    }

    // Global helper for tracking calculations
    window.trackCalculation = function (calcType) {
        sendEvent('calc', calcType);
    };
})();
