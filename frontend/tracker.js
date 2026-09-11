/**
 * Generic Analytics Tracker
 *
 * Works on any website: e-commerce, agencies, SaaS, blogs, etc.
 * No domain-specific code. Detects pricing cards, CTAs, forms,
 * external links, file downloads, scroll, and time on page.
 *
 * Usage:
 *   <script src="https://YOUR-DOMAIN/tracker.js"
 *           data-site-key="YOUR_SITE_KEY"
 *           data-api-url="https://YOUR-DOMAIN">
 *   </script>
 *
 * Optional window overrides:
 *   window.ANALYTICS_API_URL  — override API base
 *   window.ANALYTICS_SITE_KEY — override site key
 *   window.ANALYTICS_SKIP_TRACKING = true — disable tracking
 */

(function () {
    "use strict";

    // =======================================================================
    // CONFIGURATION
    // =======================================================================
    var scriptTag = document.currentScript;
    var API_BASE = window.ANALYTICS_API_URL
        || (scriptTag && scriptTag.getAttribute("data-api-url"))
        || "";
    var SITE_KEY = window.ANALYTICS_SITE_KEY
        || (scriptTag && scriptTag.getAttribute("data-site-key"))
        || "";

    if (!API_BASE || !SITE_KEY) return;

    // =======================================================================
    // SELF-TRACKING EXCLUSION
    // =======================================================================
    function shouldSkipTracking() {
        if (window.ANALYTICS_SKIP_TRACKING) return true;
        var host = window.location.hostname || "";
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
        return false;
    }

    if (shouldSkipTracking()) return;

    // =======================================================================
    // HELPER: UUID v4
    // =======================================================================
    function generateId() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // =======================================================================
    // 1. IDENTIFY VISITOR + SESSION (per site_key via separate storage key)
    // =======================================================================
    var STORAGE_PREFIX = "analytics_" + SITE_KEY + "_";

    var visitorId = localStorage.getItem(STORAGE_PREFIX + "visitor_id");
    if (!visitorId) {
        visitorId = generateId();
        localStorage.setItem(STORAGE_PREFIX + "visitor_id", visitorId);
    }

    var sessionId = sessionStorage.getItem(STORAGE_PREFIX + "session_id");
    if (!sessionId) {
        sessionId = generateId();
        sessionStorage.setItem(STORAGE_PREFIX + "session_id", sessionId);
    }

    var isFirstVisit = 0;
    if (!localStorage.getItem(STORAGE_PREFIX + "visited")) {
        isFirstVisit = 1;
        localStorage.setItem(STORAGE_PREFIX + "visited", "1");
    }

    // =======================================================================
    // 2. BROWSER / DEVICE DETECTION
    // =======================================================================
    function detectBrowser(s) {
        if (s.indexOf("Edg/") !== -1) return { name: "Edge", version: s.split("Edg/")[1].split(" ")[0] };
        if (s.indexOf("OPR/") !== -1 || s.indexOf("Opera") !== -1) return { name: "Opera", version: (s.split("OPR/")[1] || "").split(" ")[0] };
        if (s.indexOf("Chrome/") !== -1 && s.indexOf("Safari/") !== -1) return { name: "Chrome", version: s.split("Chrome/")[1].split(" ")[0] };
        if (s.indexOf("Firefox/") !== -1) return { name: "Firefox", version: s.split("Firefox/")[1].split(" ")[0] };
        if (s.indexOf("Safari/") !== -1) return { name: "Safari", version: s.split("Version/")[1].split(" ")[0] };
        return { name: "Unknown", version: "" };
    }

    function detectOS(sa) {
        if (sa.indexOf("Win") !== -1) return "Windows";
        if (sa.indexOf("Mac") !== -1) return "macOS";
        if (sa.indexOf("Linux") !== -1) return "Linux";
        if (sa.indexOf("Android") !== -1) return "Android";
        if (sa.indexOf("iPhone") !== -1 || sa.indexOf("iPad") !== -1) return "iOS";
        return "Unknown";
    }

    function detectDeviceType() {
        var w = screen.width;
        var su = navigator.userAgent.toLowerCase();
        if (/mobile|android|iphone/i.test(su)) return "Mobile";
        if (/ipad|tablet/i.test(su)) return "Tablet";
        if (w < 768) return "Mobile";
        if (w < 1024) return "Tablet";
        return "Desktop";
    }

    var ua = navigator.userAgent;
    var browser = detectBrowser(ua);
    var os = detectOS(ua);
    var deviceType = detectDeviceType();

    // =======================================================================
    // 3. UTM CAMPAIGN PARAMS
    // =======================================================================
    function getUtmParam(key) {
        try { return new URLSearchParams(window.location.search).get(key) || ""; }
        catch (e) { return ""; }
    }
    var utm = {
        utm_source: getUtmParam("utm_source"),
        utm_medium: getUtmParam("utm_medium"),
        utm_campaign: getUtmParam("utm_campaign"),
        utm_content: getUtmParam("utm_content"),
    };

    // =======================================================================
    // 4. PAGE LOAD DATA
    // =======================================================================
    var visitData = {
        site_key: SITE_KEY,
        visitor_id: visitorId,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        timezone: "",
        language: navigator.language || "",
        browser: browser.name,
        browser_version: browser.version,
        os: os,
        device_type: deviceType,
        screen_width: screen.width,
        screen_height: screen.height,
        page_url: window.location.href,
        referrer: document.referrer || "",
        page_title: document.title || "",
        is_first_visit: isFirstVisit,
        scroll_percentage: 0,
        time_on_page: 0,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
    };

    try {
        visitData.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {}

    var pageLoadTime = Date.now();

    // =======================================================================
    // 5. DELIVERY — sendBeacon with fetch fallback
    // =======================================================================
    function sendJson(url, data) {
        var payload = JSON.stringify(data);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, payload);
        } else {
            fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
            });
        }
    }

    sendJson(API_BASE + "/api/track", visitData);

    // =======================================================================
    // 6. EVENT SENDING
    // =======================================================================
    function sendEvent(eventType, eventTarget, extraProps) {
        sendJson(API_BASE + "/api/event", {
            site_key: SITE_KEY,
            visitor_id: visitorId,
            session_id: sessionId,
            timestamp: new Date().toISOString(),
            event_type: eventType,
            event_target: eventTarget || "",
            page_url: window.location.href,
            browser: browser.name,
            os: os,
            device_type: deviceType,
            properties: extraProps || {},
        });
    }

    function cleanText(s) {
        return String(s == null ? "" : s).replace(/\s+/g, " ").trim().substring(0, 200);
    }

    // =======================================================================
    // 7. GENERIC PRICE DETECTION (INR, USD, EUR, GBP, etc.)
    // =======================================================================
    var PRICE_RE = /(?:₹|Rs\.?|€|£|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

    function parsePrice(text) {
        var m = text.match(PRICE_RE);
        if (!m) return { value: null, currency: null };
        var value = parseFloat(m[1].replace(/,/g, ""));
        if (isNaN(value)) return { value: null, currency: null };
        var symbol = m[0].charAt(0);
        var currency = "USD";
        if (symbol === "₹" || m[0].indexOf("Rs") !== -1) currency = "INR";
        else if (symbol === "€") currency = "EUR";
        else if (symbol === "£") currency = "GBP";
        return { value: value, currency: currency };
    }

    // =======================================================================
    // 8. GENERIC PRODUCT/SERVICE CARD DETECTION
    // =======================================================================
    var CARD_CLASSES = /\b(pricing-card|product-card|service-card|plan-card|card)\b/i;

    function cardMeta(el) {
        var node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
            if (node.getAttribute) {
                // Explicit data-* attributes (any site can use these)
                var explicitName = node.getAttribute("data-name")
                    || node.getAttribute("data-product")
                    || node.getAttribute("data-item");
                if (explicitName) {
                    var headingEl = node.querySelector
                        ? node.querySelector("h1,h2,h3,h4,h5,h6,.card-title,.product-name,.plan-name")
                        : null;
                    var full = cleanText(node.textContent);
                    var p = parsePrice(full);

                    var price = null;
                    var currency = null;
                    var dataPrice = node.getAttribute("data-price");
                    if (dataPrice !== "" && dataPrice != null) {
                        price = Number(dataPrice);
                        currency = node.getAttribute("data-currency") || "USD";
                    }
                    if (price === null && p.value !== null) {
                        price = p.value;
                        currency = p.currency;
                    }

                    return {
                        name: explicitName
                            || cleanText(headingEl ? headingEl.textContent : "")
                            || full.split(" ").slice(0, 6).join(" "),
                        category: node.getAttribute("data-category") || "",
                        price: price,
                        currency: node.getAttribute("data-currency") || currency || "USD",
                    };
                }
            }

            // Auto-detect pricing/product cards by CSS class
            if (node.querySelector) {
                var cls = (node.className || "").toLowerCase();
                if (CARD_CLASSES.test(cls)) {
                    var headings = node.querySelectorAll("h1,h2,h3,h4,h5,h6,.card-title,.product-name");
                    var text = cleanText(node.textContent || "");
                    var price = parsePrice(text);
                    if (headings.length > 0 && price.value !== null && text.length > 4) {
                        return {
                            name: cleanText(headings[0].textContent),
                            category: node.getAttribute("data-category") || "",
                            price: price.value,
                            currency: price.currency,
                        };
                    }
                }
            }
            node = node.parentNode;
        }
        return null;
    }

    // =======================================================================
    // 9. GENERIC CONVERSION DETECTION
    // =======================================================================
    var CONVERSION_RE = /\b(buy|order|purchase|add to cart|checkout|book|subscribe|sign up|get started|contact us|enquire|get now|try|start|join)\b/i;

    function isExternalLink(href) {
        if (!href || href.indexOf("http") !== 0) return false;
        try {
            return new URL(href).hostname !== window.location.hostname;
        } catch (e) { return false; }
    }

    // =======================================================================
    // 10. CLICK TRACKING — generic for any website
    // =======================================================================
    document.addEventListener("click", function (e) {
        var target = e.target.nodeType === 1 ? e.target : (e.target.parentElement || e.target);

        // ── Links: external, conversion, file download ───────────────────
        var link = target.closest ? target.closest("a") : null;
        if (link) {
            var href = link.href || "";

            // External link
            if (isExternalLink(href)) {
                sendEvent("link_click", href);
                return;
            }

            // File download
            var exts = [".pdf", ".zip", ".doc", ".docx", ".csv", ".xlsx", ".txt", ".rar", ".exe", ".dmg", ".mp3", ".mp4"];
            var lh = href.toLowerCase();
            for (var i = 0; i < exts.length; i++) {
                if (lh.indexOf(exts[i]) !== -1) {
                    sendEvent("file_download", href);
                    return;
                }
            }
        }

        // ── Product/service card click ───────────────────────────────────
        var card = cardMeta(target);
        var clickedText = cleanText(target.textContent || "");
        var isConversion = CONVERSION_RE.test(clickedText) && clickedText.length < 80;

        if (card && card.name) {
            if (isConversion) {
                sendEvent("cta_click", card.name, {
                    target: "cta",
                    name: card.name,
                    price: card.price,
                    currency: card.currency,
                });
            } else {
                sendEvent("product_click", card.name, {
                    name: card.name,
                    category: card.category,
                    price: card.price,
                    currency: card.currency,
                });
            }
            return;
        }

        // ── Fallback: button / role=button ───────────────────────────────
        var tag = (target.tagName || "").toLowerCase();
        var role = target.getAttribute ? (target.getAttribute("role") || "") : "";
        if (tag === "button" || role === "button") {
            sendEvent("button_click", clickedText);
        }
    }, { passive: true });

    // =======================================================================
    // 11. FORM SUBMITS — generic
    // =======================================================================
    document.addEventListener("submit", function (e) {
        var form = e.target;
        var action = form.action || form.getAttribute("action") || window.location.href;
        sendEvent("form_submit", action, { action: action });
    }, { passive: true });

    // =======================================================================
    // 12. SCROLL DEPTH + MILESTONES
    // =======================================================================
    var maxScrollPercent = 0;
    var milestonesSent = {};

    function scrollPercent() {
        var top = window.pageYOffset || document.documentElement.scrollTop;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return 100;
        return Math.round((top / docHeight) * 100);
    }

    window.addEventListener("scroll", function () {
        var cur = scrollPercent();
        if (cur > maxScrollPercent) maxScrollPercent = cur;
        [25, 50, 75, 100].forEach(function (m) {
            if (cur >= m && !milestonesSent[m]) {
                milestonesSent[m] = true;
                sendEvent("scroll_milestone", m + "%", { depth: m });
            }
        });
    }, { passive: true });

    // =======================================================================
    // 13. PAGE LEAVE (beforeunload)
    // =======================================================================
    window.addEventListener("beforeunload", function () {
        var timeOnPage = (Date.now() - pageLoadTime) / 1000;
        var finalScroll = scrollPercent();
        if (finalScroll > maxScrollPercent) maxScrollPercent = finalScroll;
        sendJson(API_BASE + "/api/event", {
            site_key: SITE_KEY,
            visitor_id: visitorId,
            session_id: sessionId,
            timestamp: new Date().toISOString(),
            event_type: "page_leave",
            event_target: "",
            page_url: window.location.href,
            browser: browser.name,
            os: os,
            device_type: deviceType,
            time_on_page: Math.round(timeOnPage * 10) / 10,
            scroll_percentage: maxScrollPercent,
        });
    });

    // =======================================================================
    // 14. SECTION VIEWS — generic (any element with data-section or id)
    // =======================================================================
    var sectionSent = {};
    var sectionObserver = null;

    function observeSections() {
        if (typeof IntersectionObserver === "undefined" || sectionObserver) return;
        try {
            sectionObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var node = entry.target;
                    var key = String(
                        node.getAttribute("data-section")
                        || node.id
                        || ""
                    ).toLowerCase();
                    if (key && !sectionSent[key]) {
                        sectionSent[key] = true;
                        sendEvent("section_view", key, {
                            name: key,
                            url: window.location.href,
                        });
                    }
                });
            }, { threshold: 0.25 });

            document.querySelectorAll("[data-section], [id]").forEach(function (node) {
                var key = String(
                    node.getAttribute("data-section")
                    || node.id
                    || ""
                ).toLowerCase();
                if (key) sectionObserver.observe(node);
            });
        } catch (e) {}
    }
    observeSections();

})();
