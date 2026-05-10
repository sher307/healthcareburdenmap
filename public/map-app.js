import { feature as topojsonFeature } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

/** Fallback if CSS custom properties are missing (must match :root in health-care-burden.css). */
const BIVARIATE_FALLBACK = [
    ["#00cda7", "#009d78", "#006d4e"],
    ["#99e6de", "#95c96d", "#ed6c04"],
    ["#f9e6c4", "#ffa300", "#fc2636"]
];

/** Choropleth colors (single source; CSS :root mirrors these for design reference). */
const bivariatePalette = BIVARIATE_FALLBACK;

/** Geographic center of the contiguous US — stable initial view (Alaska and Hawaii remain reachable by pan/zoom). */
const USA_MAP_CENTER = [39.828175, -98.579534];
const USA_MAP_ZOOM = 4;

/**
 * Leaflet bounds centers are unreliable for Alaska (and often Hawaii) on this projection;
 * use an in-state point so PE markers sit on the landmass.
 */
const PE_MARKER_LATLNG_BY_FIPS = {
    "02": [64.3, -152.2],
    "12": [28.2, -82.0],
    "26": [44.3, -85.5],
    "15": [20.75, -156.45]
};

const MAP_LAYER_VISIBILITY = {
    overlay: true,
    medicalDebt: true,
    healthDeserts: true
};

function readPeMarkerColors() {
    return { fill: "#b4b8c4", stroke: "#000000" };
}

const STATE_NAME_BY_FIPS = {
    "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California",
    "08": "Colorado", "09": "Connecticut", "10": "Delaware", "11": "District of Columbia",
    "12": "Florida", "13": "Georgia", "15": "Hawaii", "16": "Idaho", "17": "Illinois",
    "18": "Indiana", "19": "Iowa", "20": "Kansas", "21": "Kentucky", "22": "Louisiana",
    "23": "Maine", "24": "Maryland", "25": "Massachusetts", "26": "Michigan", "27": "Minnesota",
    "28": "Mississippi", "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada",
    "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
    "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma",
    "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina",
    "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah", "50": "Vermont",
    "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming"
};

function fipsFromFeature(feat) {
    if (feat == null) return "";
    if (feat.id != null && feat.id !== "") {
        return String(feat.id).padStart(2, "0");
    }
    const p = feat.properties || {};
    if (p.STATEFP != null) return String(p.STATEFP).padStart(2, "0");
    if (p.GEO_ID != null) {
        const s = String(p.GEO_ID);
        const m = s.match(/US(\d{2})$/);
        if (m) return m[1];
    }
    return "";
}

function clampBin(n) {
    const x = Number(n);
    const r = Number.isFinite(x) ? Math.round(x) : 0;
    return Math.max(0, Math.min(2, r));
}

function healthcareDesertBinFromHrsa(score) {
    const s = Number(score);
    if (!Number.isFinite(s)) return 0;
    if (s >= 18) return 2; // High: 18-26
    if (s >= 9) return 1; // Medium: 9-17
    return 0; // Low: 0-8
}

function healthcareDesertRangeLabel(bin) {
    if (bin === 2) return "18-26";
    if (bin === 1) return "9-17";
    return "0-8";
}

function fillForRow(row) {
    if (!row) return "#e8e8e8";
    if (!MAP_LAYER_VISIBILITY.medicalDebt && !MAP_LAYER_VISIBILITY.healthDeserts) return "#D9D9D9";
    const desert = MAP_LAYER_VISIBILITY.healthDeserts ? healthcareDesertBinFromHrsa(row.hrsa_primary_care_hpsa_score) : 0;
    const debt = MAP_LAYER_VISIBILITY.medicalDebt ? clampBin(row.medical_debt_bin) : 0;
    return bivariatePalette[desert][debt];
}

function fmtPct(x) {
    return (100 * x).toFixed(1) + "%";
}

function ordinal(n) {
    const x = Number(n) || 0;
    const j = x % 10;
    const k = x % 100;
    if (j === 1 && k !== 11) return `${x}st`;
    if (j === 2 && k !== 12) return `${x}nd`;
    if (j === 3 && k !== 13) return `${x}rd`;
    return `${x}th`;
}

function rankBy(states, valueAccessor) {
    const sorted = [...states].sort((a, b) => (valueAccessor(b) || 0) - (valueAccessor(a) || 0));
    const rankMap = new Map();
    sorted.forEach((row, idx) => rankMap.set(row.state_fips, idx + 1));
    return rankMap;
}

function tooltipHtml(row, fips) {
    const name = STATE_NAME_BY_FIPS[fips] || (row && row.state_abbr) || fips;
    if (!row) return `<strong>${name}</strong><br>No data`;
    const desertBin = healthcareDesertBinFromHrsa(row.hrsa_primary_care_hpsa_score);
    const desertLabel = desertBin === 2 ? "High" : desertBin === 1 ? "Med" : "Low";
    return [
        `<strong>${name}</strong>`,
        `Medical debt share: ${fmtPct(row.medical_debt_share)}`,
        `Health Care Desert score: ${row.hrsa_primary_care_hpsa_score.toFixed(2)} (${desertLabel})`,
        `PE-owned hospitals: ${row.pe_owned_hospitals}`
    ].join("<br>");
}

/** Map circle radius in pixels; used for states with PE-owned hospitals only. */
function peRadius(count, maxPe) {
    const c = Math.max(0, Number(count) || 0);
    const max = Math.max(1, Number(maxPe) || 0);
    const minR = 5;
    const maxR = 24; // 48px max diameter
    if (c === 0) return minR;
    const t = Math.sqrt(c / max);
    return Math.max(8, Math.round(t * maxR));
}

function getLegendSwatchTooltipEl() {
    let tip = document.getElementById("legend-swatch-tooltip");
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "legend-swatch-tooltip";
    tip.style.position = "fixed";
    tip.style.zIndex = "1200";
    tip.style.maxWidth = "260px";
    tip.style.padding = "6px 8px";
    tip.style.border = "1px solid #000";
    tip.style.background = "#fff";
    tip.style.color = "#000";
    tip.style.font = '12px/1.3 "Instrument Sans", system-ui, sans-serif';
    tip.style.pointerEvents = "none";
    tip.style.display = "none";
    document.body.appendChild(tip);
    return tip;
}

function showLegendSwatchTooltip(target, html) {
    const tip = getLegendSwatchTooltipEl();
    const rect = target.getBoundingClientRect();
    tip.innerHTML = html;
    tip.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    tip.style.top = `${Math.round(rect.top - 10)}px`;
    tip.style.transform = "translate(-50%, -100%)";
    tip.style.display = "block";
}

function hideLegendSwatchTooltip() {
    const tip = document.getElementById("legend-swatch-tooltip");
    if (tip) tip.style.display = "none";
}

function computeBinRanges(rows, valueKey, binKey) {
    const ranges = {
        0: { min: Infinity, max: -Infinity },
        1: { min: Infinity, max: -Infinity },
        2: { min: Infinity, max: -Infinity }
    };
    rows.forEach((row) => {
        const bin = clampBin(row[binKey]);
        const val = Number(row[valueKey]);
        if (!Number.isFinite(val)) return;
        ranges[bin].min = Math.min(ranges[bin].min, val);
        ranges[bin].max = Math.max(ranges[bin].max, val);
    });
    return ranges;
}

function buildDatasetRangeLabels(ranges, formatter) {
    const labels = { 0: "N/A", 1: "N/A", 2: "N/A" };
    [0, 1, 2].forEach((idx) => {
        const range = ranges?.[idx];
        if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return;
        labels[idx] = `${formatter(range.min)}-${formatter(range.max)}`;
    });
    return labels;
}

function buildBivariateLegend(targetId = "bivariate-grid", binRanges = null, selectedCell = null, onCellToggle = null) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = "";
    const isMedicalDebtOff = !MAP_LAYER_VISIBILITY.medicalDebt;
    const isHealthDesertsOff = !MAP_LAYER_VISIBILITY.healthDeserts;
    const areBothAxesOff = isMedicalDebtOff && isHealthDesertsOff;
    const legendChart = el.closest(".legend-chart");
    const debtAxisLabel = legendChart ? legendChart.querySelector(".axis-label--debt") : null;
    const desertAxisLabel = legendChart
        ? legendChart.closest(".bivariate-legend-grid-wrap")?.querySelector(".axis-label-left")
        : null;
    const debtAxisBins = legendChart ? legendChart.querySelectorAll(".axis-bin-row span") : [];
    const debtAxisBinRow = legendChart ? legendChart.querySelector(".axis-bin-row") : null;
    const debtAxisOpacity = isMedicalDebtOff ? "0.4" : "1";
    const desertAxisOpacity = isHealthDesertsOff ? "0.4" : "1";

    if (debtAxisLabel) {
        debtAxisLabel.style.display = "";
        debtAxisLabel.style.opacity = debtAxisOpacity;
    }
    if (desertAxisLabel) desertAxisLabel.style.opacity = desertAxisOpacity;
    if (debtAxisBinRow) {
        debtAxisBinRow.style.display = "";
        debtAxisBinRow.style.opacity = debtAxisOpacity;
    }
    debtAxisBins.forEach((binEl) => { binEl.style.opacity = debtAxisOpacity; });
    const desertBandLabels = {
        0: healthcareDesertRangeLabel(0),
        1: healthcareDesertRangeLabel(1),
        2: healthcareDesertRangeLabel(2)
    };
    const debtBandLabels = buildDatasetRangeLabels(
        binRanges?.debt,
        (v) => `${(v * 100).toFixed(1)}%`
    );

    for (let row = 2; row >= 0; row -= 1) {
        const label = document.createElement("div");
        label.textContent = row === 2 ? "High" : row === 1 ? "Mid" : "Low";
        label.style.opacity = isHealthDesertsOff ? "0.4" : "1";
        el.appendChild(label);
        for (let col = 0; col < 3; col += 1) {
            const sw = document.createElement("div");
            sw.className = "swatch";
            if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
                sw.classList.add("is-active");
            }
            sw.style.backgroundColor = bivariatePalette[row][col];
            const desertLevel = row === 2 ? "High" : row === 1 ? "Medium" : "Low";
            const debtLevel = col === 2 ? "High" : col === 1 ? "Medium" : "Low";
            const desertRange = desertBandLabels[row];
            const debtRange = debtBandLabels[col];
            const swatchTooltipHtml =
                `<div class="legend-swatch-tooltip__row"><span class="legend-swatch-tooltip__axis">Health Care Deserts (${desertLevel}):</span> ${desertRange}</div>` +
                `<div class="legend-swatch-tooltip__row"><span class="legend-swatch-tooltip__axis">Medical Debt (${debtLevel}):</span> ${debtRange}</div>`;
            const swatchTooltipLabel = `Health Care Deserts (${desertLevel}) ${desertRange}; Medical Debt (${debtLevel}) ${debtRange}`;
            sw.title = swatchTooltipLabel;
            sw.setAttribute("aria-label", swatchTooltipLabel);
            sw.tabIndex = 0;
            sw.addEventListener("mouseenter", () => showLegendSwatchTooltip(sw, swatchTooltipHtml));
            sw.addEventListener("focus", () => showLegendSwatchTooltip(sw, swatchTooltipHtml));
            sw.addEventListener("click", () => {
                showLegendSwatchTooltip(sw, swatchTooltipHtml);
                if (onCellToggle) onCellToggle(row, col);
            });
            sw.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (onCellToggle) onCellToggle(row, col);
                }
            });
            sw.addEventListener("mouseleave", hideLegendSwatchTooltip);
            sw.addEventListener("blur", hideLegendSwatchTooltip);
            if (areBothAxesOff) {
                sw.style.opacity = "0.4";
            } else if (isMedicalDebtOff || isHealthDesertsOff) {
                const emphasizeCol = !isMedicalDebtOff || col === 0;
                const emphasizeRow = !isHealthDesertsOff || row === 0;
                sw.style.opacity = emphasizeCol && emphasizeRow ? "1" : "0.4";
            } else {
                sw.style.opacity = "1";
            }
            el.appendChild(sw);
        }
    }
}

function peMarkerLatLng(fips, layer) {
    const fixed = PE_MARKER_LATLNG_BY_FIPS[fips];
    if (fixed) return L.latLng(fixed[0], fixed[1]);
    return layer.getBounds().getCenter();
}

function applyPeRadialFill(marker) {
    const el = marker.getElement ? marker.getElement() : marker._path;
    if (!el || !el.ownerSVGElement) return;
    const svg = el.ownerSVGElement;
    const gradientId = "pe-overlay-radial-fill";
    let grad = svg.querySelector(`#${gradientId}`);
    if (!grad) {
        let defs = svg.querySelector("defs");
        if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            svg.insertBefore(defs, svg.firstChild);
        }
        grad = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
        grad.setAttribute("id", gradientId);
        grad.setAttribute("cx", "50%");
        grad.setAttribute("cy", "50%");
        grad.setAttribute("r", "50%");

        const stopInner = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stopInner.setAttribute("offset", "0%");
        stopInner.setAttribute("stop-color", "#FFFFFF");
        grad.appendChild(stopInner);

        const stopOuter = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stopOuter.setAttribute("offset", "100%");
        stopOuter.setAttribute("stop-color", "#000000");
        grad.appendChild(stopOuter);

        defs.appendChild(grad);
    }
    el.setAttribute("fill", `url(#${gradientId})`);
}

function initPanelControls() {
    const panel = document.getElementById("map-side-panel");
    const legendView = document.getElementById("legend-view");
    const detailsView = document.getElementById("details-view");
    const legendClose = document.getElementById("legend-close-btn");
    const legendOpen = document.getElementById("legend-open-btn");
    const detailsClose = document.getElementById("details-close-btn");
    const detailsLegendToggle = document.getElementById("details-legend-toggle");
    const detailsDetailsToggle = document.getElementById("details-details-toggle");

    if (!panel || !legendView || !detailsView) return null;

    function showLegend() {
        panel.classList.remove("panel-collapsed");
        panel.classList.remove("details-mode");
        legendView.classList.add("is-active");
        detailsView.classList.remove("is-active");
        detailsView.classList.remove("legend-expanded");
        if (detailsLegendToggle) {
            detailsLegendToggle.textContent = "Legend ▼";
            detailsLegendToggle.setAttribute("aria-expanded", "false");
        }
        if (detailsDetailsToggle) {
            detailsDetailsToggle.textContent = "Details ▲";
            detailsDetailsToggle.setAttribute("aria-expanded", "true");
        }
        legendOpen && legendOpen.classList.remove("is-visible");
    }

    function hidePanel() {
        panel.classList.add("panel-collapsed");
        legendOpen && legendOpen.classList.add("is-visible");
    }

    function showDetails() {
        panel.classList.remove("panel-collapsed");
        panel.classList.add("details-mode");
        legendView.classList.remove("is-active");
        detailsView.classList.add("is-active");
        detailsView.classList.remove("legend-expanded");
        detailsView.classList.remove("details-collapsed");
        if (detailsLegendToggle) {
            detailsLegendToggle.textContent = "Legend ▼";
            detailsLegendToggle.setAttribute("aria-expanded", "false");
        }
        if (detailsDetailsToggle) {
            detailsDetailsToggle.textContent = "Details ▲";
            detailsDetailsToggle.setAttribute("aria-expanded", "true");
        }
        legendOpen && legendOpen.classList.remove("is-visible");
    }

    function toggleDetailsLegend() {
        if (!detailsView || !detailsLegendToggle || !detailsDetailsToggle) return;
        const expanded = !detailsView.classList.contains("legend-expanded");
        detailsView.classList.toggle("legend-expanded", expanded);
        if (expanded) detailsView.classList.remove("details-collapsed");
        detailsLegendToggle.textContent = expanded ? "Legend ▲" : "Legend ▼";
        detailsLegendToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    function toggleDetailsCards() {
        if (!detailsView || !detailsLegendToggle || !detailsDetailsToggle) return;
        const collapsed = !detailsView.classList.contains("details-collapsed");
        detailsView.classList.toggle("details-collapsed", collapsed);
        if (collapsed) {
            detailsView.classList.remove("legend-expanded");
            detailsLegendToggle.textContent = "Legend ▼";
            detailsLegendToggle.setAttribute("aria-expanded", "false");
            detailsDetailsToggle.textContent = "Details ▼";
            detailsDetailsToggle.setAttribute("aria-expanded", "false");
        } else {
            detailsDetailsToggle.textContent = "Details ▲";
            detailsDetailsToggle.setAttribute("aria-expanded", "true");
        }
    }

    legendClose && legendClose.addEventListener("click", hidePanel);
    legendOpen && legendOpen.addEventListener("click", showLegend);
    detailsClose && detailsClose.addEventListener("click", showLegend);
    detailsLegendToggle && detailsLegendToggle.addEventListener("click", toggleDetailsLegend);
    detailsDetailsToggle && detailsDetailsToggle.addEventListener("click", toggleDetailsCards);

    const mobilePanelMq = window.matchMedia("(max-width: 960px)");
    const syncPanelForViewport = (event) => {
        if (event.matches) {
            hidePanel();
        } else {
            showLegend();
        }
    };
    syncPanelForViewport(mobilePanelMq);
    if (typeof mobilePanelMq.addEventListener === "function") {
        mobilePanelMq.addEventListener("change", syncPanelForViewport);
    } else if (typeof mobilePanelMq.addListener === "function") {
        mobilePanelMq.addListener(syncPanelForViewport);
    }

    return { showLegend, showDetails };
}

function fillStateDetails(row, fips, rankMaps) {
    const nameEl = document.getElementById("details-state-name");
    const peRankEl = document.getElementById("detail-pe-rank");
    const peTotalEl = document.getElementById("detail-pe-total");
    const pePctEl = document.getElementById("detail-pe-pct");
    const desertRankEl = document.getElementById("detail-desert-rank");
    const hpsaEl = document.getElementById("detail-hpsa");
    const debtRankEl = document.getElementById("detail-debt-rank");
    const debtPctEl = document.getElementById("detail-debt-pct");

    if (!row) return;
    if (nameEl) nameEl.textContent = STATE_NAME_BY_FIPS[fips] || row.state_abbr || "State";
    if (peRankEl) peRankEl.textContent = ordinal(rankMaps.peRank.get(fips));
    if (peTotalEl) peTotalEl.textContent = String(row.pe_owned_hospitals || 0);
    if (pePctEl) pePctEl.textContent = `${Number(row.pe_owned_hospital_pct_of_private || 0).toFixed(1)}%`;
    if (desertRankEl) desertRankEl.textContent = ordinal(rankMaps.desertRank.get(fips));
    if (hpsaEl) hpsaEl.textContent = Number(row.hrsa_primary_care_hpsa_score || 0).toFixed(1);
    if (debtRankEl) debtRankEl.textContent = ordinal(rankMaps.debtRank.get(fips));
    if (debtPctEl) debtPctEl.textContent = fmtPct(row.medical_debt_share || 0);
}

/**
 * National stats strip (Figma 94:6538). Care-desert % = share of states in highest desert tertile;
 * PE total = sum of state counts. Medical debt millions matches Figma headline unless JSON provides
 * `national_medical_debt_millions_approx` (optional).
 */
function fillNationalStats(states, joinedMeta) {
    const pctEl = document.getElementById("stat-care-desert-pct");
    const peEl = document.getElementById("stat-pe-hospitals");
    const debtEl = document.getElementById("stat-debt-millions");
    if (!pctEl || !peEl || !debtEl) return;

    const n = states.length;
    const highDesert = states.filter((s) => healthcareDesertBinFromHrsa(s.hrsa_primary_care_hpsa_score) === 2).length;
    const pct = n > 0 ? Math.round((100 * highDesert) / n) : 0;
    const peTotal = states.reduce((acc, s) => acc + (Number(s.pe_owned_hospitals) || 0), 0);

    const debtM =
        joinedMeta && joinedMeta.national_medical_debt_millions_approx != null
            ? Number(joinedMeta.national_medical_debt_millions_approx)
            : 15;

    pctEl.textContent = String(pct);
    peEl.textContent = String(peTotal);
    debtEl.textContent = String(debtM);
}

function buildCircleLegend(maxPe, peFill, targetId = "circle-legend") {
    const container = document.getElementById(targetId);
    if (!container) return;
    container.innerHTML = `
        <div class="circle-legend-scale">
            <div class="circle-legend-item" data-pe-range="xs" role="button" tabindex="0" aria-pressed="false">
                <div class="circle-legend-dot circle-legend-dot--xs" aria-hidden="true"></div>
                <span>5-15</span>
            </div>
            <div class="circle-legend-item" data-pe-range="sm" role="button" tabindex="0" aria-pressed="false">
                <div class="circle-legend-dot circle-legend-dot--sm" aria-hidden="true"></div>
                <span>16-26</span>
            </div>
            <div class="circle-legend-item" data-pe-range="md" role="button" tabindex="0" aria-pressed="false">
                <div class="circle-legend-dot circle-legend-dot--md" aria-hidden="true"></div>
                <span>27-37</span>
            </div>
            <div class="circle-legend-item" data-pe-range="lg" role="button" tabindex="0" aria-pressed="false">
                <div class="circle-legend-dot circle-legend-dot--lg" aria-hidden="true"></div>
                <span>100+</span>
            </div>
        </div>
    `;
}

async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json();
}

function peRangeKeyForCount(count) {
    if (count >= 100) return "lg";
    if (count >= 27 && count <= 37) return "md";
    if (count >= 16 && count <= 26) return "sm";
    if (count >= 5 && count <= 15) return "xs";
    return null;
}

function stateMatchesFilters(row, selectedPeRange = null, selectedBivariateCell = null, selectedStateFips = null) {
    if (!row) return false;
    const hasLegendFilter = Boolean(selectedPeRange || selectedBivariateCell);
    if (!hasLegendFilter && selectedStateFips && row.state_fips !== selectedStateFips) return false;
    if (selectedPeRange) {
        const peCount = Number(row.pe_owned_hospitals) || 0;
        if (peRangeKeyForCount(peCount) !== selectedPeRange) return false;
    }
    if (selectedBivariateCell) {
        if (healthcareDesertBinFromHrsa(row.hrsa_primary_care_hpsa_score) !== selectedBivariateCell.row) return false;
        if (clampBin(row.medical_debt_bin) !== selectedBivariateCell.col) return false;
    }
    return true;
}

function styleForFeature(stateRows, selectedPeRange = null, selectedBivariateCell = null, selectedStateFips = null) {
    return function (feat) {
        const fips = fipsFromFeature(feat);
        const row = stateRows.get(fips);
        const isMatchedState = stateMatchesFilters(row, selectedPeRange, selectedBivariateCell, selectedStateFips);
        return {
            fillColor: isMatchedState ? fillForRow(row) : "#D9D9D9",
            weight: 0,
            opacity: 0,
            fillOpacity: 0.96
        };
    };
}

function borderStyleForFeature(stateRows, selectedPeRange = null) {
    return function (feat) {
        return {
            color: "#ffffff",
            weight: 1.25,
            opacity: 1,
            fill: false
        };
    };
}

async function main() {
    const [us, joined] = await Promise.all([
        loadJson("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
        loadJson(new URL("data/health_map_states.json", document.baseURI).href)
    ]);
    const binRanges = {
        debt: computeBinRanges(joined.states, "medical_debt_share", "medical_debt_bin")
    };
    const stateRows = new Map(joined.states.map((row) => [row.state_fips, row]));
    const maxPe = Math.max(1, ...joined.states.map((d) => d.pe_owned_hospitals || 0));
    const peColors = readPeMarkerColors();
    const overlayToggleEl = document.getElementById("toggle-overlay");
    const debtToggleEl = document.getElementById("toggle-medical-debt");
    const desertToggleEl = document.getElementById("toggle-health-deserts");
    const stateSelectInputEl = document.getElementById("state-select-input");
    const stateSelectSuggestionsEl = document.getElementById("state-select-suggestions");
    const stateSelectClearBtnEl = document.getElementById("state-select-clear-btn");
    const detailsStateSelectInputEl = document.getElementById("details-state-select-input");
    const detailsStateSelectSuggestionsEl = document.getElementById("details-state-select-suggestions");
    const detailsStateSelectClearBtnEl = document.getElementById("details-state-select-clear-btn");
    const panelControls = initPanelControls();
    const rankMaps = {
        peRank: rankBy(joined.states, (r) => Number(r.pe_owned_hospitals) || 0),
        desertRank: rankBy(joined.states, (r) => Number(r.hrsa_primary_care_hpsa_score) || 0),
        debtRank: rankBy(joined.states, (r) => Number(r.medical_debt_share) || 0)
    };

    const statesFc = topojsonFeature(us, us.objects.states);
    statesFc.features = statesFc.features.filter((f) => stateRows.has(fipsFromFeature(f)));

    const map = L.map("map", {
        center: USA_MAP_CENTER,
        zoom: USA_MAP_ZOOM,
        zoomControl: false,
        minZoom: 3,
        maxZoom: 10,
        scrollWheelZoom: true,
        attributionControl: true
    });

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
        attribution: 'Leaflet | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © CARTO',
        subdomains: "abcd",
        maxZoom: 20
    }).addTo(map);

    map.createPane("pePane");
    map.createPane("stateBorderPane");
    map.createPane("selectedStateBorderPane");
    map.createPane("selectedPePane");
    map.getPane("pePane").style.zIndex = 650;
    map.getPane("stateBorderPane").style.zIndex = 700;
    map.getPane("selectedStateBorderPane").style.zIndex = 760;
    map.getPane("selectedPePane").style.zIndex = 770;
    map.getPane("tooltipPane").style.zIndex = 800;
    const peMarkers = [];
    const peLayer = L.layerGroup().addTo(map);
    const selectedPeLayer = L.layerGroup().addTo(map);
    let selectedPeRange = null;
    let selectedBivariateCell = null;
    let selectedStateFips = null;
    let activeTooltipLayer = null;
    const registerSingleTooltip = (layer) => {
        layer.on("tooltipopen", () => {
            if (activeTooltipLayer && activeTooltipLayer !== layer) {
                activeTooltipLayer.closeTooltip();
            }
            activeTooltipLayer = layer;
        });
        layer.on("tooltipclose", () => {
            if (activeTooltipLayer === layer) activeTooltipLayer = null;
        });
    };

    const geoLayer = L.geoJSON(statesFc, {
        style: styleForFeature(stateRows, selectedPeRange, selectedBivariateCell, selectedStateFips),
        onEachFeature(feature, layer) {
            const fips = fipsFromFeature(feature);
            const row = stateRows.get(fips);
            layer.bindTooltip(() => tooltipHtml(row, fips), {
                sticky: true,
                direction: "top",
                opacity: 1,
                className: "state-tip"
            });
            registerSingleTooltip(layer);

            layer.on("mouseover", () => {
                const borderLayerForState = borderLayersByFips.get(fips);
                if (borderLayerForState) {
                    borderLayerForState.setStyle({ weight: 2.5, color: "#202020" });
                    borderLayerForState.bringToFront();
                }
            });
            layer.on("mouseout", () => {
                const borderLayerForState = borderLayersByFips.get(fips);
                if (borderLayerForState) borderLayer.resetStyle(borderLayerForState);
                bringSelectedBorderToFront();
            });
            layer.on("click", () => {
                selectStateByFips(fips);
            });
        }
    }).addTo(map);
    const borderLayer = L.geoJSON(statesFc, {
        pane: "stateBorderPane",
        interactive: false,
        style: borderStyleForFeature(stateRows)
    }).addTo(map);
    const borderLayersByFips = new Map();
    borderLayer.eachLayer((layer) => {
        borderLayersByFips.set(fipsFromFeature(layer.feature), layer);
    });
    const stateFeatureByFips = new Map(statesFc.features.map((feat) => [fipsFromFeature(feat), feat]));
    const selectedStateBorderLayer = L.geoJSON(null, {
        pane: "selectedStateBorderPane",
        interactive: false,
        style: {
            color: "#000000",
            weight: 2.5,
            opacity: 1,
            fill: false
        }
    }).addTo(map);
    const updateSelectedStateBorder = () => {
        selectedStateBorderLayer.clearLayers();
        if (!selectedStateFips) return;
        const selectedFeature = stateFeatureByFips.get(selectedStateFips);
        if (selectedFeature) selectedStateBorderLayer.addData(selectedFeature);
    };
    const bringSelectedBorderToFront = () => {
        selectedStateBorderLayer.bringToFront();
    };

    geoLayer.eachLayer((layer) => {
        const feature = layer.feature;
        const fips = fipsFromFeature(feature);
        const row = stateRows.get(fips);
        if (!row) return;
        const peCount = row.pe_owned_hospitals || 0;
        if (peCount <= 0) return;
        const c = peMarkerLatLng(fips, layer);
        const r = peRadius(peCount, maxPe);
        const m = L.circleMarker(c, {
            radius: r,
            pane: "pePane",
            fillColor: peColors.fill,
            color: peColors.stroke,
            weight: 1,
            opacity: 1,
            fillOpacity: 0.4
        }).addTo(peLayer);
        peMarkers.push({ marker: m, peCount, fips });
        applyPeRadialFill(m);

        m.bindTooltip(() => tooltipHtml(row, fips), {
            sticky: true,
            direction: "top",
            className: "state-tip"
        });
        registerSingleTooltip(m);

        m.on("mouseover", () => {
            m.setStyle({ weight: 1.5, fillOpacity: 0.6 });
            applyPeRadialFill(m);
            m.bringToFront();
        });
        m.on("mouseout", () => {
            m.setStyle({ weight: 1, fillOpacity: 0.4 });
            applyPeRadialFill(m);
        });
        m.on("click", () => {
            m.setStyle({ weight: 1.5, fillOpacity: 0.6 });
            applyPeRadialFill(m);
            selectStateByFips(fips);
        });
    });

    const applyPeMarkerFilter = () => {
        peMarkers.forEach(({ marker, peCount, fips }) => {
            const markerRange = peRangeKeyForCount(peCount);
            const visible = !selectedPeRange || markerRange === selectedPeRange;
            peLayer.removeLayer(marker);
            selectedPeLayer.removeLayer(marker);
            if (!visible) return;
            const targetLayer = selectedStateFips && fips === selectedStateFips ? selectedPeLayer : peLayer;
            if (!targetLayer.hasLayer(marker)) marker.addTo(targetLayer);
            if (targetLayer === selectedPeLayer && marker.bringToFront) marker.bringToFront();
        });
    };

    const updateCircleLegendSelectionUi = () => {
        document.querySelectorAll(".circle-legend-item[data-pe-range]").forEach((el) => {
            const isActive = el.getAttribute("data-pe-range") === selectedPeRange;
            el.classList.toggle("is-active", isActive);
            el.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
    };

    const refreshStateStyles = () => {
        geoLayer.setStyle(styleForFeature(stateRows, selectedPeRange, selectedBivariateCell, selectedStateFips));
        borderLayer.setStyle(borderStyleForFeature(stateRows, selectedPeRange));
        updateSelectedStateBorder();
        applyPeMarkerFilter();
        bringSelectedBorderToFront();
    };

    const clearSelectedState = (clearLegendFilters = false) => {
        selectedStateFips = null;
        if (clearLegendFilters) {
            selectedPeRange = null;
            selectedBivariateCell = null;
            updateCircleLegendSelectionUi();
            buildBivariateLegend("bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
            buildBivariateLegend("details-bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
        }
        if (stateSelectInputEl) stateSelectInputEl.value = "";
        if (detailsStateSelectInputEl) detailsStateSelectInputEl.value = "";
        refreshStateStyles();
        panelControls && panelControls.showLegend();
    };

    const selectStateByFips = (fips, allowToggleOff = true) => {
        if (allowToggleOff && selectedStateFips === fips) {
            clearSelectedState(true);
            return;
        }
        const row = stateRows.get(fips);
        if (!row) return;
        selectedStateFips = fips;
        refreshStateStyles();
        fillStateDetails(row, fips, rankMaps);
        panelControls && panelControls.showDetails();
        const selectedName = STATE_NAME_BY_FIPS[fips] || row.state_abbr || "";
        if (stateSelectInputEl) stateSelectInputEl.value = selectedName;
        if (detailsStateSelectInputEl) detailsStateSelectInputEl.value = selectedName;
    };

    const setPeRangeFilter = (rangeKey) => {
        selectedPeRange = selectedPeRange === rangeKey ? null : rangeKey;
        updateCircleLegendSelectionUi();
        applyPeMarkerFilter();
        refreshStateStyles();
    };

    const setBivariateCellFilter = (row, col) => {
        const isSameCell = selectedBivariateCell && selectedBivariateCell.row === row && selectedBivariateCell.col === col;
        selectedBivariateCell = isSameCell ? null : { row, col };
        buildBivariateLegend("bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
        buildBivariateLegend("details-bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
        refreshStateStyles();
    };

    const selectableStateEntries = [...stateRows.keys()]
        .map((fips) => ({ fips, name: STATE_NAME_BY_FIPS[fips] }))
        .filter((item) => Boolean(item.name))
        .sort((a, b) => a.name.localeCompare(b.name));

    const stateFipsByName = new Map(selectableStateEntries.map((item) => [item.name.toLowerCase(), item.fips]));
    const bindStateSearchInput = (inputEl, suggestionsEl) => {
        if (!inputEl || !suggestionsEl) return;

        const hideSuggestions = () => {
            suggestionsEl.style.display = "none";
            suggestionsEl.innerHTML = "";
        };
        const renderSuggestions = (query) => {
            const q = query.trim().toLowerCase();
            if (!q) {
                hideSuggestions();
                return;
            }
            const matches = selectableStateEntries
                .filter((item) => item.name.toLowerCase().includes(q))
                .slice(0, 10);
            if (!matches.length) {
                hideSuggestions();
                return;
            }
            suggestionsEl.innerHTML = matches
                .map((item) => `<div class="state-select-suggestion" data-fips="${item.fips}" data-name="${item.name}" role="option">${item.name}</div>`)
                .join("");
            suggestionsEl.style.display = "block";
        };
        const trySelectTypedState = () => {
            const typed = inputEl.value.trim().toLowerCase();
            if (!typed) return;
            const fips = stateFipsByName.get(typed);
            if (fips) {
                selectStateByFips(fips, false);
                hideSuggestions();
            }
        };

        inputEl.addEventListener("input", () => renderSuggestions(inputEl.value));
        inputEl.addEventListener("focus", () => renderSuggestions(inputEl.value));
        inputEl.addEventListener("change", trySelectTypedState);
        inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") trySelectTypedState();
            if (event.key === "Escape") hideSuggestions();
        });
        suggestionsEl.addEventListener("mousedown", (event) => {
            const target = event.target.closest(".state-select-suggestion");
            if (!target) return;
            const fips = target.getAttribute("data-fips");
            const stateName = target.getAttribute("data-name") || "";
            if (stateName) inputEl.value = stateName;
            if (fips) selectStateByFips(fips, false);
            hideSuggestions();
            event.preventDefault();
        });
        document.addEventListener("click", (event) => {
            const clickedInside = inputEl.contains(event.target) || suggestionsEl.contains(event.target);
            if (!clickedInside) hideSuggestions();
        });
    };
    bindStateSearchInput(stateSelectInputEl, stateSelectSuggestionsEl);
    bindStateSearchInput(detailsStateSelectInputEl, detailsStateSelectSuggestionsEl);
    stateSelectClearBtnEl && stateSelectClearBtnEl.addEventListener("click", () => clearSelectedState(true));
    detailsStateSelectClearBtnEl && detailsStateSelectClearBtnEl.addEventListener("click", () => clearSelectedState(true));

    const bindCircleLegendFilter = (targetId) => {
        const legend = document.getElementById(targetId);
        if (!legend) return;
        legend.querySelectorAll(".circle-legend-item[data-pe-range]").forEach((item) => {
            const rangeKey = item.getAttribute("data-pe-range");
            item.addEventListener("click", () => setPeRangeFilter(rangeKey));
            item.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPeRangeFilter(rangeKey);
                }
            });
        });
    };

    // Keep all PE overlays at fixed screen-space size while zooming.
    map.on("zoomend", () => {
        peMarkers.forEach(({ marker, peCount }) => {
            marker.setRadius(peRadius(peCount, maxPe));
            applyPeRadialFill(marker);
        });
    });

    const applyLayerVisibility = () => {
        if (overlayToggleEl) MAP_LAYER_VISIBILITY.overlay = overlayToggleEl.checked;
        if (debtToggleEl) MAP_LAYER_VISIBILITY.medicalDebt = debtToggleEl.checked;
        if (desertToggleEl) MAP_LAYER_VISIBILITY.healthDeserts = desertToggleEl.checked;

        buildBivariateLegend("bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
        buildBivariateLegend("details-bivariate-grid", binRanges, selectedBivariateCell, setBivariateCellFilter);
        refreshStateStyles();

        if (MAP_LAYER_VISIBILITY.overlay) {
            if (!map.hasLayer(peLayer)) peLayer.addTo(map);
            if (!map.hasLayer(selectedPeLayer)) selectedPeLayer.addTo(map);
            applyPeMarkerFilter();
        } else if (map.hasLayer(peLayer)) {
            map.removeLayer(peLayer);
            map.removeLayer(selectedPeLayer);
        }
    };

    overlayToggleEl && overlayToggleEl.addEventListener("change", applyLayerVisibility);
    debtToggleEl && debtToggleEl.addEventListener("change", applyLayerVisibility);
    desertToggleEl && desertToggleEl.addEventListener("change", applyLayerVisibility);
    applyLayerVisibility();

    buildCircleLegend(maxPe, peColors.fill, "circle-legend");
    buildCircleLegend(maxPe, peColors.fill, "details-circle-legend");
    bindCircleLegendFilter("circle-legend");
    bindCircleLegendFilter("details-circle-legend");
    updateCircleLegendSelectionUi();

    fillNationalStats(joined.states, joined);

    const stampEl = document.getElementById("data-timestamp");
    if (stampEl) stampEl.textContent = "Dataset generated: " + (joined.generated_at_utc || "N/A");
}

main().catch((err) => {
    console.error(err);
    const stampEl = document.getElementById("data-timestamp");
    if (stampEl) stampEl.textContent = "Unable to load map data. Open the console for details.";
});
