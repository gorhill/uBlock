// Repo: https://github.com/AdguardTeam/Scriptlets
// Source: https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/google-ima3-dai.ts
// License: https://github.com/AdguardTeam/Scriptlets/blob/master/LICENSE (GPLv3)
// Commit: https://github.com/AdguardTeam/Scriptlets/blob/eedd995c41/src/redirects/google-ima3-dai.ts
/* eslint-disable */ 
(function(source, args) {
    const flag = "done";
    const uniqueIdentifier = source.uniqueId + source.name + "_" + (Array.isArray(args) ? args.join("_") : "");
    if (source.uniqueId) {
        if (Window.prototype.toString[uniqueIdentifier] === flag) {
            return;
        }
    }
    function GoogleIma3Dai(source) {
        var streamEventTypes = {
            AD_BREAK_ENDED: "adBreakEnded",
            AD_BREAK_STARTED: "adBreakStarted",
            AD_PERIOD_ENDED: "adPeriodEnded",
            AD_PERIOD_STARTED: "adPeriodStarted",
            AD_PROGRESS: "adProgress",
            CLICK: "click",
            COMPLETE: "complete",
            CUEPOINTS_CHANGED: "cuepointsChanged",
            ERROR: "error",
            FIRST_QUARTILE: "firstquartile",
            HIDE_AD_UI: "hideAdUi",
            LOADED: "loaded",
            MIDPOINT: "midpoint",
            PAUSED: "paused",
            RESUMED: "resumed",
            SHOW_AD_UI: "showAdUi",
            SKIPPABLE_STATE_CHANGED: "skippableStateChanged",
            SKIPPED: "skip",
            STARTED: "started",
            STREAM_INITIALIZED: "streamInitialized",
            THIRD_QUARTILE: "thirdquartile",
            VIDEO_CLICKED: "videoClicked"
        };
        var isRecord = function isRecord(value) {
            return typeof value === "object" && value !== null;
        };
        var schedule = function schedule(callback) {
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(callback);
                return;
            }
            setTimeout(callback, 0);
        };
        var toStringRecord = function toStringRecord(value) {
            if (!isRecord(value)) {
                return {};
            }
            var result = {};
            var propertyNames = Object.keys(value);
            for (var propertyIndex = 0; propertyIndex < propertyNames.length; propertyIndex += 1) {
                var propertyName = propertyNames[propertyIndex];
                result[propertyName] = String(value[propertyName]);
            }
            return result;
        };
        var getStringValue = function getStringValue(value) {
            return typeof value === "string" && value.length > 0 ? value : null;
        };
        var initializeEventHandler = function initializeEventHandler(instance) {
            instance.listeners = new Map;
        };
        var normalizeEventTypes = function normalizeEventTypes(type) {
            if (typeof type === "string") {
                return [ type ];
            }
            if (!Array.isArray(type)) {
                return [];
            }
            var eventTypes = [];
            for (var eventTypeIndex = 0; eventTypeIndex < type.length; eventTypeIndex += 1) {
                var eventType = type[eventTypeIndex];
                if (typeof eventType === "string") {
                    eventTypes.push(eventType);
                }
            }
            return eventTypes;
        };
        var initializeStreamRequest = function initializeStreamRequest(instance, streamRequest) {
            instance.adTagParameters = {};
            instance.apiKey = null;
            instance.authToken = null;
            instance.format = "hls";
            instance.networkCode = null;
            instance.omidAccessModeRules = null;
            instance.streamActivityMonitorId = null;
            if (isRecord(streamRequest)) {
                Object.assign(instance, streamRequest);
            }
            instance.adTagParameters = toStringRecord(instance.adTagParameters);
            if (typeof instance.format !== "string" || instance.format.length === 0) {
                instance.format = "hls";
            }
        };
        var initializePodStreamRequest = function initializePodStreamRequest(instance, podStreamRequest) {
            initializeStreamRequest(instance, podStreamRequest);
            instance.customAssetKey = typeof instance.customAssetKey === "string" ? instance.customAssetKey : "";
        };
        var EventHandler = function EventHandler() {
            initializeEventHandler(this);
        };
        EventHandler.prototype.addEventListener = function(type, listener) {
            if (typeof listener !== "function") {
                return;
            }
            var eventTypes = normalizeEventTypes(type);
            for (var eventTypeIndex = 0; eventTypeIndex < eventTypes.length; eventTypeIndex += 1) {
                var eventType = eventTypes[eventTypeIndex];
                if (!this.listeners.has(eventType)) {
                    this.listeners.set(eventType, new Set);
                }
                var listeners = this.listeners.get(eventType);
                if (listeners) {
                    listeners.add(listener);
                }
            }
        };
        EventHandler.prototype.removeEventListener = function(type, listener) {
            if (typeof listener !== "function") {
                return;
            }
            var eventTypes = normalizeEventTypes(type);
            for (var eventTypeIndex = 0; eventTypeIndex < eventTypes.length; eventTypeIndex += 1) {
                var listeners = this.listeners.get(eventTypes[eventTypeIndex]);
                if (!listeners) {
                    continue;
                }
                listeners.delete(listener);
            }
        };
        EventHandler.prototype.dispatchEvent = function(streamEvent) {
            var listeners = this.listeners.get(streamEvent.type);
            if (!listeners) {
                return;
            }
            for (var _i = 0, _Array$from = Array.from(listeners); _i < _Array$from.length; _i++) {
                var _listener = _Array$from[_i];
                try {
                    _listener(streamEvent);
                } catch (error) {
                    logMessage(source, error);
                }
            }
        };
        var StreamRequest = function StreamRequest(streamRequest) {
            initializeStreamRequest(this, streamRequest);
        };
        var LiveStreamRequest = function LiveStreamRequest(liveStreamRequest) {
            initializeStreamRequest(this, liveStreamRequest);
            this.assetKey = typeof this.assetKey === "string" ? this.assetKey : "";
        };
        Object.setPrototypeOf(LiveStreamRequest.prototype, StreamRequest.prototype);
        var PodStreamRequest = function PodStreamRequest(podStreamRequest) {
            initializePodStreamRequest(this, podStreamRequest);
        };
        Object.setPrototypeOf(PodStreamRequest.prototype, StreamRequest.prototype);
        var VideoStitcherLiveStreamRequest = function VideoStitcherLiveStreamRequest(videoStitcherLiveStreamRequest) {
            initializePodStreamRequest(this, videoStitcherLiveStreamRequest);
            this.liveStreamEventId = typeof this.liveStreamEventId === "string" ? this.liveStreamEventId : "";
            this.oAuthToken = typeof this.oAuthToken === "string" ? this.oAuthToken : null;
            this.projectNumber = typeof this.projectNumber === "string" ? this.projectNumber : null;
            this.region = typeof this.region === "string" ? this.region : null;
            this.videoStitcherSessionOptions = isRecord(this.videoStitcherSessionOptions) ? this.videoStitcherSessionOptions : null;
        };
        Object.setPrototypeOf(VideoStitcherLiveStreamRequest.prototype, PodStreamRequest.prototype);
        var VideoStitcherVodStreamRequest = function VideoStitcherVodStreamRequest(videoStitcherVodStreamRequest) {
            initializeStreamRequest(this, videoStitcherVodStreamRequest);
            this.adTagUrl = typeof this.adTagUrl === "string" ? this.adTagUrl : "";
            this.contentSourceUrl = typeof this.contentSourceUrl === "string" ? this.contentSourceUrl : "";
            this.oAuthToken = typeof this.oAuthToken === "string" ? this.oAuthToken : null;
            this.projectNumber = typeof this.projectNumber === "string" ? this.projectNumber : null;
            this.region = typeof this.region === "string" ? this.region : null;
            this.videoStitcherSessionOptions = isRecord(this.videoStitcherSessionOptions) ? this.videoStitcherSessionOptions : null;
            this.vodConfigId = typeof this.vodConfigId === "string" ? this.vodConfigId : "";
        };
        Object.setPrototypeOf(VideoStitcherVodStreamRequest.prototype, StreamRequest.prototype);
        var VODStreamRequest = function VODStreamRequest(vodStreamRequest) {
            initializeStreamRequest(this, vodStreamRequest);
            this.contentSourceId = typeof this.contentSourceId === "string" ? this.contentSourceId : "";
            this.videoId = typeof this.videoId === "string" ? this.videoId : "";
        };
        Object.setPrototypeOf(VODStreamRequest.prototype, StreamRequest.prototype);
        var StreamData = function StreamData(streamData) {
            this.adPeriodData = null;
            this.adProgressData = null;
            this.cuepoints = [];
            this.errorMessage = null;
            this.manifestFormat = "HLS";
            this.streamId = null;
            this.subtitles = [];
            this.url = "";
            if (isRecord(streamData)) {
                Object.assign(this, streamData);
            }
        };
        var StreamEvent = function StreamEvent(type, streamData, ad) {
            this.type = type;
            this.streamData = streamData || new StreamData;
            this.ad = ad || null;
        };
        StreamEvent.Type = streamEventTypes;
        StreamEvent.prototype.getAd = function() {
            return this.ad;
        };
        StreamEvent.prototype.getStreamData = function() {
            return this.streamData;
        };
        var UiSettings = function UiSettings() {
            this.locale = "";
        };
        UiSettings.prototype.getLocale = function() {
            return this.locale;
        };
        UiSettings.prototype.setLocale = function(locale) {
            this.locale = locale;
        };
        var daiSdkFeatureFlagsStorage = new WeakMap;
        var getStoredDaiSdkFeatureFlags = function getStoredDaiSdkFeatureFlags(instance) {
            var storedFeatureFlags = daiSdkFeatureFlagsStorage.get(instance);
            if (storedFeatureFlags) {
                return storedFeatureFlags;
            }
            var nextFeatureFlags = {};
            daiSdkFeatureFlagsStorage.set(instance, nextFeatureFlags);
            return nextFeatureFlags;
        };
        var DaiSdkSettingsContainer = function DaiSdkSettingsContainer() {
            daiSdkFeatureFlagsStorage.set(this, {});
        };
        DaiSdkSettingsContainer.prototype.getFeatureFlags = function() {
            return getStoredDaiSdkFeatureFlags(this);
        };
        DaiSdkSettingsContainer.prototype.setFeatureFlags = function(featureFlags) {
            daiSdkFeatureFlagsStorage.set(this, Object.assign({}, featureFlags));
        };
        var normalizeStreamRequest = function normalizeStreamRequest(streamRequest) {
            if (streamRequest instanceof StreamRequest) {
                return streamRequest;
            }
            if (isRecord(streamRequest)) {
                if (typeof streamRequest.liveStreamEventId === "string") {
                    return new VideoStitcherLiveStreamRequest(streamRequest);
                }
                if (typeof streamRequest.contentSourceUrl === "string" || typeof streamRequest.vodConfigId === "string" || typeof streamRequest.adTagUrl === "string") {
                    return new VideoStitcherVodStreamRequest(streamRequest);
                }
                if (typeof streamRequest.customAssetKey === "string") {
                    return new PodStreamRequest(streamRequest);
                }
                if (typeof streamRequest.assetKey === "string") {
                    return new LiveStreamRequest(streamRequest);
                }
                if (typeof streamRequest.contentSourceId === "string" || typeof streamRequest.videoId === "string") {
                    return new VODStreamRequest(streamRequest);
                }
            }
            return new StreamRequest;
        };
        var hasLiveIdentifiers = function hasLiveIdentifiers(streamRequest) {
            var liveStreamRequest = streamRequest;
            return typeof liveStreamRequest.assetKey === "string" && liveStreamRequest.assetKey.length > 0;
        };
        var hasVideoStitcherLiveIdentifiers = function hasVideoStitcherLiveIdentifiers(streamRequest) {
            var videoStitcherLiveStreamRequest = streamRequest;
            return typeof videoStitcherLiveStreamRequest.liveStreamEventId === "string" && videoStitcherLiveStreamRequest.liveStreamEventId.length > 0;
        };
        var hasPodIdentifiers = function hasPodIdentifiers(streamRequest) {
            var podStreamRequest = streamRequest;
            return typeof podStreamRequest.networkCode === "string" && podStreamRequest.networkCode.length > 0 && typeof podStreamRequest.customAssetKey === "string" && podStreamRequest.customAssetKey.length > 0;
        };
        var hasVideoStitcherVodIdentifiers = function hasVideoStitcherVodIdentifiers(streamRequest) {
            var videoStitcherVodStreamRequest = streamRequest;
            var hasContentSourceUrl = typeof videoStitcherVodStreamRequest.contentSourceUrl === "string" && videoStitcherVodStreamRequest.contentSourceUrl.length > 0;
            var hasVodConfigId = typeof videoStitcherVodStreamRequest.vodConfigId === "string" && videoStitcherVodStreamRequest.vodConfigId.length > 0;
            return hasContentSourceUrl || hasVodConfigId;
        };
        var hasVodIdentifiers = function hasVodIdentifiers(streamRequest) {
            var vodStreamRequest = streamRequest;
            return typeof vodStreamRequest.contentSourceId === "string" && vodStreamRequest.contentSourceId.length > 0 && typeof vodStreamRequest.videoId === "string" && vodStreamRequest.videoId.length > 0;
        };
        var hasIdentifiers = function hasIdentifiers(streamRequest) {
            return hasLiveIdentifiers(streamRequest) || hasPodIdentifiers(streamRequest) || hasVideoStitcherLiveIdentifiers(streamRequest) || hasVideoStitcherVodIdentifiers(streamRequest) || hasVodIdentifiers(streamRequest);
        };
        var getFallbackStreamId = function getFallbackStreamId(streamRequest) {
            var liveStreamRequest = streamRequest;
            var videoStitcherLiveStreamRequest = streamRequest;
            var videoStitcherVodStreamRequest = streamRequest;
            var vodStreamRequest = streamRequest;
            if (typeof videoStitcherVodStreamRequest.vodConfigId === "string" && videoStitcherVodStreamRequest.vodConfigId.length > 0) {
                return `mock-video-stitcher-vod-${videoStitcherVodStreamRequest.vodConfigId}`;
            }
            if (typeof videoStitcherVodStreamRequest.contentSourceUrl === "string" && videoStitcherVodStreamRequest.contentSourceUrl.length > 0) {
                return "mock-video-stitcher-vod";
            }
            if (typeof videoStitcherLiveStreamRequest.liveStreamEventId === "string" && videoStitcherLiveStreamRequest.liveStreamEventId.length > 0) {
                return `mock-video-stitcher-live-${videoStitcherLiveStreamRequest.liveStreamEventId}`;
            }
            if (typeof liveStreamRequest.assetKey === "string" && liveStreamRequest.assetKey.length > 0) {
                return `mock-live-${liveStreamRequest.assetKey}`;
            }
            if (typeof vodStreamRequest.videoId === "string" && vodStreamRequest.videoId.length > 0) {
                return `mock-vod-${vodStreamRequest.videoId}`;
            }
            return "mock-stream";
        };
        var getDefaultManifestFormat = function getDefaultManifestFormat(streamRequest) {
            return typeof streamRequest.format === "string" && streamRequest.format.toLowerCase() === "dash" ? "DASH" : "HLS";
        };
        var createStreamData = function createStreamData(streamRequest, cuepoints, errorMessage, streamDataOverrides) {
            var streamData = new StreamData({
                cuepoints: cuepoints.slice(),
                errorMessage: errorMessage,
                manifestFormat: getDefaultManifestFormat(streamRequest),
                streamId: getFallbackStreamId(streamRequest),
                url: ""
            });
            if (isRecord(streamDataOverrides)) {
                Object.assign(streamData, streamDataOverrides);
            }
            return streamData;
        };
        var appendRequestParameters = function appendRequestParameters(requestUrl, streamRequest) {
            var parameterNames = Object.keys(streamRequest.adTagParameters);
            for (var parameterIndex = 0; parameterIndex < parameterNames.length; parameterIndex += 1) {
                var parameterName = parameterNames[parameterIndex];
                requestUrl.searchParams.set(parameterName, streamRequest.adTagParameters[parameterName]);
            }
            if (streamRequest.apiKey) {
                requestUrl.searchParams.set("api-key", streamRequest.apiKey);
            }
            if (streamRequest.authToken) {
                requestUrl.searchParams.set("auth-token", streamRequest.authToken);
            }
            if (streamRequest.streamActivityMonitorId) {
                requestUrl.searchParams.set("dai-sam-id", streamRequest.streamActivityMonitorId);
            }
        };
        var buildLiveRequestUrl = function buildLiveRequestUrl(streamRequest, hostName) {
            var requestUrl = new URL(`${hostName}/ssai/event/${streamRequest.assetKey}/streams`);
            appendRequestParameters(requestUrl, streamRequest);
            return requestUrl.toString();
        };
        var buildPodRequestUrl = function buildPodRequestUrl(streamRequest, hostName) {
            var requestUrl = new URL(`${hostName}/ssai/pods/api/v1/network/${streamRequest.networkCode}` + `/custom_asset/${streamRequest.customAssetKey}/stream`);
            var manifestType = streamRequest.format.toLowerCase() === "dash" ? "dash" : "hls";
            appendRequestParameters(requestUrl, streamRequest);
            requestUrl.searchParams.set("manifest-type", manifestType);
            return requestUrl.toString();
        };
        var buildVodRequestUrl = function buildVodRequestUrl(streamRequest, hostName) {
            var requestFormat = streamRequest.format.toLowerCase() === "dash" ? "dash" : "hls";
            var requestUrl = new URL(`${hostName}/ondemand/${requestFormat}/content/${streamRequest.contentSourceId}` + `/vid/${streamRequest.videoId}/streams`);
            appendRequestParameters(requestUrl, streamRequest);
            return requestUrl.toString();
        };
        var MAIN_HOST_NAME = "https://dai.google.com";
        var FALLBACK_HOST_NAME = "https://pubads.g.doubleclick.net";
        var getStreamRequestUrls = function getStreamRequestUrls(streamRequest) {
            if (hasPodIdentifiers(streamRequest)) {
                return [ buildPodRequestUrl(streamRequest, MAIN_HOST_NAME), buildPodRequestUrl(streamRequest, FALLBACK_HOST_NAME) ];
            }
            if (hasLiveIdentifiers(streamRequest)) {
                return [ buildLiveRequestUrl(streamRequest, MAIN_HOST_NAME), buildLiveRequestUrl(streamRequest, FALLBACK_HOST_NAME) ];
            }
            if (hasVodIdentifiers(streamRequest)) {
                return [ buildVodRequestUrl(streamRequest, MAIN_HOST_NAME), buildVodRequestUrl(streamRequest, FALLBACK_HOST_NAME) ];
            }
            return [];
        };
        var readFetchResponseData = async function readFetchResponseData(response) {
            var typedResponse = response;
            if (typedResponse && typedResponse.ok === false) {
                throw new Error(`Stream initialization failed with status ${String(typedResponse.status || 0)}`);
            }
            if (typedResponse && typeof typedResponse.json === "function") {
                var jsonResponse = await typedResponse.json();
                return isRecord(jsonResponse) ? jsonResponse : {};
            }
            return isRecord(response) ? response : {};
        };
        var getResponseErrorMessage = function getResponseErrorMessage(responseData) {
            return getStringValue(responseData.errorMessage) || getStringValue(responseData.error_message);
        };
        var createStreamDataFromResponse = function createStreamDataFromResponse(streamRequest, cuepoints, responseData) {
            var podManifestUrl = getStringValue(responseData.pod_manifest_url) || getStringValue(responseData.podManifestUrl) || "";
            var responseStreamId = getStringValue(responseData.stream_id) || getStringValue(responseData.streamId);
            var streamUrl = getStringValue(responseData.stream_manifest) || getStringValue(responseData.streamUrl) || podManifestUrl || "";
            var responseErrorMessage = getResponseErrorMessage(responseData);
            var hasInitializedStream = streamUrl.length > 0 || responseStreamId !== null && responseStreamId.length > 0;
            var errorMessage = responseErrorMessage || (hasInitializedStream ? null : "Stream initialization response missing stream URL");
            var manifestFormat = getStringValue(responseData.manifest_format) || getStringValue(responseData.manifestFormat) || getDefaultManifestFormat(streamRequest);
            var streamId = responseStreamId || getFallbackStreamId(streamRequest);
            var subtitles = Array.isArray(responseData.subtitles) ? responseData.subtitles : [];
            return createStreamData(streamRequest, cuepoints, errorMessage, {
                manifestFormat: manifestFormat,
                podManifestUrl: podManifestUrl,
                pod_manifest_url: podManifestUrl,
                streamId: streamId,
                subtitles: subtitles,
                url: streamUrl
            });
        };
        var getErrorMessage = function getErrorMessage(error) {
            if (isRecord(error) && typeof error.message === "string" && error.message.length > 0) {
                return error.message;
            }
            return "Stream initialization failed";
        };
        var hideAdUiElement = function hideAdUiElement(streamManager) {
            if (!streamManager.adUiElement) {
                return;
            }
            streamManager.adUiElement.style.display = "none";
        };
        var showVideoControls = function showVideoControls(streamManager) {
            if (!streamManager.videoElement || streamManager.videoElement.controls) {
                return;
            }
            streamManager.videoElement.controls = true;
        };
        var handleContentLoaded = function handleContentLoaded(streamManager) {
            hideAdUiElement(streamManager);
            showVideoControls(streamManager);
        };
        var isContentLoadedEventType = function isContentLoadedEventType(eventType) {
            return eventType === StreamEvent.Type.LOADED || eventType === StreamEvent.Type.STREAM_INITIALIZED;
        };
        var StreamManager = function StreamManager(videoElement, adUiElement, uiSettings) {
            initializeEventHandler(this);
            this.videoElement = videoElement || null;
            this.adUiElement = adUiElement || null;
            this.uiSettings = uiSettings || new UiSettings;
            this.clickElement = adUiElement || null;
            this.streamData = new StreamData;
            this.streamMonitor = {};
            this.streamRequest = null;
            this.cuepoints = [];
            this.lastMetadata = null;
            this.lastTimedMetadata = null;
        };
        Object.setPrototypeOf(StreamManager.prototype, EventHandler.prototype);
        StreamManager.prototype.contentTimeForStreamTime = function(streamTime) {
            return typeof streamTime === "number" ? streamTime : 0;
        };
        StreamManager.prototype.destroy = function() {
            this.reset();
        };
        StreamManager.prototype.focus = function() {
            var clickElement = this.clickElement;
            if (!clickElement || typeof clickElement.focus !== "function") {
                return;
            }
            try {
                clickElement.focus();
            } catch (error) {
                logMessage(source, error);
            }
        };
        StreamManager.prototype.getAdSkippableState = function() {
            return true;
        };
        StreamManager.prototype.getStreamData = function() {
            return this.streamData;
        };
        StreamManager.prototype.loadStreamMetadata = function() {
            handleContentLoaded(this);
            this.dispatchEvent(new StreamEvent(StreamEvent.Type.LOADED, this.streamData));
        };
        StreamManager.prototype.onTimedMetadata = function(metadata) {
            this.lastTimedMetadata = metadata;
        };
        StreamManager.prototype.previousCuePointForStreamTime = function(streamTime) {
            var previousCuePoint = null;
            for (var cuepointIndex = 0; cuepointIndex < this.cuepoints.length; cuepointIndex += 1) {
                var cuepoint = this.cuepoints[cuepointIndex];
                if (typeof cuepoint.start !== "number") {
                    continue;
                }
                if (cuepoint.start <= streamTime) {
                    previousCuePoint = cuepoint;
                }
            }
            return previousCuePoint;
        };
        StreamManager.prototype.processMetadata = function(type, data, timestamp) {
            this.lastMetadata = {
                data: data,
                timestamp: timestamp,
                type: type
            };
        };
        StreamManager.prototype.replaceAdTagParameters = function(adTagParameters) {
            if (!this.streamRequest) {
                this.streamRequest = new StreamRequest;
            }
            this.streamRequest.adTagParameters = toStringRecord(adTagParameters);
        };
        StreamManager.prototype.requestStream = function(streamRequest) {
            var _this = this;
            var normalizedRequest = normalizeStreamRequest(streamRequest);
            this.streamRequest = normalizedRequest;
            var dispatchStreamEvent = function dispatchStreamEvent(eventType, streamData) {
                _this.streamData = streamData;
                if (isContentLoadedEventType(eventType)) {
                    handleContentLoaded(_this);
                }
                schedule((function() {
                    _this.dispatchEvent(new StreamEvent(StreamEvent.Type.STREAM_INITIALIZED, streamData));
                    _this.dispatchEvent(new StreamEvent(eventType, streamData));
                }));
            };
            if (!hasIdentifiers(normalizedRequest)) {
                dispatchStreamEvent(StreamEvent.Type.ERROR, createStreamData(normalizedRequest, this.cuepoints, "Missing stream request identifiers"));
                return;
            }
            var requestUrls = getStreamRequestUrls(normalizedRequest);
            if (requestUrls.length > 0) {
                var activeRequest = normalizedRequest;
                var _fetchStreamData = async function fetchStreamData(requestIndex) {
                    try {
                        var fetchResponse = await fetch(requestUrls[requestIndex], {
                            method: "POST",
                            credentials: "include"
                        });
                        var responseData = await readFetchResponseData(fetchResponse);
                        if (_this.streamRequest !== activeRequest) {
                            return;
                        }
                        var _streamData = createStreamDataFromResponse(activeRequest, _this.cuepoints, responseData);
                        var eventType = _streamData.errorMessage ? StreamEvent.Type.ERROR : StreamEvent.Type.LOADED;
                        dispatchStreamEvent(eventType, _streamData);
                    } catch (error) {
                        if (_this.streamRequest !== activeRequest) {
                            return;
                        }
                        if (requestIndex + 1 < requestUrls.length) {
                            await _fetchStreamData(requestIndex + 1);
                            return;
                        }
                        dispatchStreamEvent(StreamEvent.Type.ERROR, createStreamData(activeRequest, _this.cuepoints, getErrorMessage(error)));
                    }
                };
                _fetchStreamData(0);
                return;
            }
            dispatchStreamEvent(StreamEvent.Type.LOADED, createStreamData(normalizedRequest, this.cuepoints, null));
        };
        StreamManager.prototype.reset = function() {
            this.cuepoints = [];
            this.lastMetadata = null;
            this.lastTimedMetadata = null;
            this.streamData = new StreamData;
            this.streamRequest = null;
        };
        StreamManager.prototype.setClickElement = function(clickElement) {
            if (this.adUiElement) {
                return;
            }
            this.clickElement = clickElement;
        };
        StreamManager.prototype.streamTimeForContentTime = function(contentTime) {
            return typeof contentTime === "number" ? contentTime : 0;
        };
        var api = {
            DaiSdkSettings: new DaiSdkSettingsContainer,
            LiveStreamRequest: LiveStreamRequest,
            PodStreamRequest: PodStreamRequest,
            StreamData: StreamData,
            StreamEvent: StreamEvent,
            StreamManager: StreamManager,
            StreamRequest: StreamRequest,
            UiSettings: UiSettings,
            VideoStitcherLiveStreamRequest: VideoStitcherLiveStreamRequest,
            VideoStitcherVodStreamRequest: VideoStitcherVodStreamRequest,
            VODStreamRequest: VODStreamRequest
        };
        var globalWindow = window;
        var googleNamespace = isRecord(globalWindow.google) ? globalWindow.google : {};
        if (!isRecord(globalWindow.google)) {
            globalWindow.google = googleNamespace;
        }
        var imaNamespace = isRecord(googleNamespace.ima) ? googleNamespace.ima : {};
        googleNamespace.ima = imaNamespace;
        var daiNamespace = isRecord(imaNamespace.dai) ? imaNamespace.dai : {};
        imaNamespace.dai = daiNamespace;
        var apiNamespace = isRecord(daiNamespace.api) ? daiNamespace.api : {};
        daiNamespace.api = apiNamespace;
        Object.assign(apiNamespace, api);
        hit(source);
    }
    function hit(e) {
        if (e.verbose) {
            try {
                var n = console.trace.bind(console), i = "[AdGuard] ";
                "corelibs" === e.engine ? i += e.ruleText : (e.domainName && (i += `${e.domainName}`), 
                e.args ? i += `#%#//scriptlet('${e.name}', '${e.args.join("', '")}')` : i += `#%#//scriptlet('${e.name}')`), 
                n && n(i);
            } catch (e) {}
            "function" == typeof window.__debug && window.__debug(e);
        }
    }
    function logMessage(e, o) {
        var r = arguments.length > 2 && void 0 !== arguments[2] && arguments[2], a = !(arguments.length > 3 && void 0 !== arguments[3]) || arguments[3], {name: n, verbose: g} = e;
        if (r || g) {
            var i = console.log;
            a ? i(`${n}: ${o}`) : Array.isArray(o) ? i(`${n}:`, ...o) : i(`${n}:`, o);
        }
    }
    const updatedArgs = args ? [].concat(source).concat(args) : [ source ];
    try {
        GoogleIma3Dai.apply(this, updatedArgs);
        if (source.uniqueId) {
            Object.defineProperty(Window.prototype.toString, uniqueIdentifier, {
                value: flag,
                enumerable: false,
                writable: false,
                configurable: false
            });
        }
    } catch (e) {
        console.log(e);
    }
})({
    name: "google-ima3-dai",
    args: []
}, []);
