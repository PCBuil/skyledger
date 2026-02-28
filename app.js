const searchForm = document.getElementById("searchForm");
const cityInput = document.getElementById("cityInput");
const searchResults = document.getElementById("searchResults");
const geoBtn = document.getElementById("geoBtn");
const unitToggle = document.getElementById("unitToggle");
const locationLabel = document.getElementById("locationLabel");
const currentContent = document.getElementById("currentContent");
const hourlyContent = document.getElementById("hourlyContent");
const dailyContent = document.getElementById("dailyContent");
const alertsContent = document.getElementById("alertsContent");
const favoritesList = document.getElementById("favoritesList");
const favoriteBtn = document.getElementById("favoriteBtn");

let selectedLocation = null;
let favorites = loadFavorites();
let unitSystem = loadUnitPreference();
let tempChart = null;
let rainChart = null;

const weatherCodes = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail"
};

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = cityInput.value.trim();
  if (!query) return;
  await searchCities(query);
});

unitToggle.addEventListener("change", async () => {
  unitSystem = unitToggle.value;
  persistUnitPreference();
  if (selectedLocation) {
    await loadWeatherForSelected();
  }
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const reverse = await fetchJSON(
        `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=en&count=1`
      );

      const first = reverse?.results?.[0];
      selectedLocation = {
        name: first?.name || "Current Location",
        country: first?.country || "",
        country_code: first?.country_code || "",
        latitude,
        longitude,
        timezone: first?.timezone || "auto"
      };

      await loadWeatherForSelected();
      searchResults.innerHTML = "";
    },
    (error) => {
      alert(`Unable to fetch location: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

favoriteBtn.addEventListener("click", () => {
  if (!selectedLocation) return;

  const exists = favorites.some(
    (f) => f.latitude === selectedLocation.latitude && f.longitude === selectedLocation.longitude
  );

  if (!exists) {
    favorites.push(selectedLocation);
    persistFavorites();
    renderFavorites();
  }
});

async function searchCities(query) {
  searchResults.innerHTML = `<p class="muted">Searching...</p>`;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query
  )}&count=8&language=en&format=json`;

  const data = await fetchJSON(url);
  const results = data?.results || [];

  if (!results.length) {
    searchResults.innerHTML = `<p class="muted">No matching cities found.</p>`;
    return;
  }

  searchResults.innerHTML = "";
  results.forEach((item) => {
    const row = document.createElement("div");
    row.className = "search-item";
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <div class="muted">${item.admin1 || ""}${item.admin1 ? ", " : ""}${item.country}</div>
      </div>
      <button class="btn btn-small" type="button">Select</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
      selectedLocation = item;
      await loadWeatherForSelected();
      searchResults.innerHTML = "";
    });

    searchResults.appendChild(row);
  });
}

async function loadWeatherForSelected() {
  if (!selectedLocation) return;

  const { latitude, longitude, name, country, timezone = "auto" } = selectedLocation;
  const units = getUnitConfig();
  locationLabel.textContent = `${name}${country ? ", " + country : ""} (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`;
  favoriteBtn.disabled = false;
  persistLastViewedLocation();

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code` +
    `&hourly=temperature_2m,precipitation_probability,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
    `&forecast_days=10&timezone=${encodeURIComponent(timezone)}` +
    `&temperature_unit=${units.temperatureApi}&wind_speed_unit=${units.windApi}&precipitation_unit=${units.precipApi}`;

  const data = await fetchJSON(weatherUrl);
  if (!data) {
    currentContent.textContent = "Unable to load weather.";
    return;
  }

  renderCurrent(data.current, units);
  renderHourly(data.hourly, data.current?.time, units);
  renderDaily(data.daily, units);
  renderCharts(data.hourly, data.current?.time, units);
  await renderAlerts(latitude, longitude, selectedLocation.country_code || "");
}

function renderCurrent(current, units) {
  if (!current) {
    currentContent.innerHTML = `<p class="muted">Current conditions unavailable.</p>`;
    return;
  }

  currentContent.innerHTML = `
    <div>
      <div class="current-temp">${Math.round(current.temperature_2m)} ${units.tempLabel}</div>
      <div>${weatherCodes[current.weather_code] || "Unknown"}</div>
    </div>
    <div class="metrics">
      <div>Feels like: ${Math.round(current.apparent_temperature)} ${units.tempLabel}</div>
      <div>Humidity: ${current.relative_humidity_2m}%</div>
      <div>Wind: ${Math.round(current.wind_speed_10m)} ${units.windLabel}</div>
      <div>Precip: ${current.precipitation ?? 0} ${units.precipLabel}</div>
    </div>
  `;
}

function renderHourly(hourly, currentTime, units) {
  const todaySlice = getTodayHourlySlice(hourly, currentTime);
  const times = todaySlice.times;
  const temps = todaySlice.temps;
  const rainChance = todaySlice.rainChance;

  if (!times.length) {
    hourlyContent.innerHTML = `<p class="muted">Hourly data unavailable.</p>`;
    return;
  }

  hourlyContent.innerHTML = "";
  for (let i = 0; i < times.length; i += 1) {
    const row = document.createElement("div");
    row.className = "hourly-item";
    row.innerHTML = `<strong>${formatHourLabel(times[i])}</strong>  ${Math.round(
      temps[i]
    )} ${units.tempLabel}, rain chance ${rainChance[i] ?? 0}%`;
    hourlyContent.appendChild(row);
  }
}

function renderDaily(daily, units) {
  const days = daily?.time || [];
  if (!days.length) {
    dailyContent.innerHTML = `<p class="muted">Daily forecast unavailable.</p>`;
    return;
  }

  dailyContent.innerHTML = "";
  for (let i = 0; i < days.length; i += 1) {
    const row = document.createElement("div");
    row.className = "daily-item";
    const date = new Date(days[i]);
    row.innerHTML = `
      <strong>${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</strong>
      <div>${weatherCodes[daily.weather_code[i]] || "Unknown"}</div>
      <div>High ${Math.round(daily.temperature_2m_max[i])} ${units.tempLabel} / Low ${Math.round(daily.temperature_2m_min[i])} ${units.tempLabel}</div>
      <div>Rain ${daily.precipitation_sum[i] ?? 0} ${units.precipLabel} (${daily.precipitation_probability_max[i] ?? 0}%)</div>
    `;
    dailyContent.appendChild(row);
  }
}

async function renderAlerts(lat, lon, countryCode) {
  alertsContent.innerHTML = `<p class="muted">Checking active alerts...</p>`;

  if (countryCode !== "US") {
    alertsContent.innerHTML = `<p class="muted">Detailed storm/warning alerts are currently shown for U.S. locations only.</p>`;
    return;
  }

  const alertsData = await fetchJSON(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
  const features = alertsData?.features || [];

  if (!features.length) {
    alertsContent.innerHTML = `<p class="muted">No active alerts for this location.</p>`;
    return;
  }

  alertsContent.innerHTML = "";
  features.slice(0, 6).forEach((alert) => {
    const props = alert.properties || {};
    const box = document.createElement("div");
    box.className = "alert-item";
    box.innerHTML = `
      <h3 class="alert-title">${props.event || "Weather Alert"}</h3>
      <div><strong>Severity:</strong> ${props.severity || "Unknown"}</div>
      <div><strong>Effective:</strong> ${formatDateTime(props.effective)}</div>
      <div>${truncate(props.headline || props.description || "No details available.", 220)}</div>
    `;
    alertsContent.appendChild(box);
  });
}

function renderCharts(hourly, currentTime, units) {
  const todaySlice = getTodayHourlySlice(hourly, currentTime);
  const labels = todaySlice.times.map((t) => formatHourLabel(t, true));
  const temps = todaySlice.temps;
  const rain = todaySlice.rainAmount;

  if (tempChart) tempChart.destroy();
  if (rainChart) rainChart.destroy();

  const tempCtx = document.getElementById("tempChart").getContext("2d");
  const rainCtx = document.getElementById("rainChart").getContext("2d");

  tempChart = new Chart(tempCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temp (${units.tempLabel})`,
          data: temps,
          borderColor: "#0e7a68",
          backgroundColor: "rgba(14,122,104,0.15)",
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } }
    }
  });

  rainChart = new Chart(rainCtx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: `Rain (${units.precipLabel})`,
          data: rain,
          backgroundColor: "#ff9f43"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } }
    }
  });
}

function renderFavorites() {
  favoritesList.innerHTML = "";

  if (!favorites.length) {
    favoritesList.innerHTML = `<li class="muted">No favorites saved yet.</li>`;
    return;
  }

  favorites.forEach((fav, index) => {
    const li = document.createElement("li");
    li.className = "favorite-item";
    li.innerHTML = `
      <button class="btn btn-small" type="button">${fav.name}, ${fav.country || ""}</button>
      <button class="btn btn-small remove-btn" type="button">Remove</button>
    `;

    li.querySelector("button").addEventListener("click", async () => {
      selectedLocation = fav;
      await loadWeatherForSelected();
    });

    li.querySelector(".remove-btn").addEventListener("click", () => {
      favorites.splice(index, 1);
      persistFavorites();
      renderFavorites();
    });

    favoritesList.appendChild(li);
  });
}

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem("weatherFavorites") || "[]");
  } catch {
    return [];
  }
}

function persistFavorites() {
  localStorage.setItem("weatherFavorites", JSON.stringify(favorites));
}

function loadUnitPreference() {
  const stored = localStorage.getItem("weatherUnitSystem");
  return stored === "imperial" ? "imperial" : "metric";
}

function persistUnitPreference() {
  localStorage.setItem("weatherUnitSystem", unitSystem);
}

function getUnitConfig() {
  if (unitSystem === "imperial") {
    return {
      temperatureApi: "fahrenheit",
      windApi: "mph",
      precipApi: "inch",
      tempLabel: "F",
      windLabel: "mph",
      precipLabel: "in"
    };
  }

  return {
    temperatureApi: "celsius",
    windApi: "kmh",
    precipApi: "mm",
    tempLabel: "C",
    windLabel: "km/h",
    precipLabel: "mm"
  };
}

function persistLastViewedLocation() {
  if (!selectedLocation) return;
  localStorage.setItem("weatherLastLocation", JSON.stringify(selectedLocation));
}

function loadLastViewedLocation() {
  try {
    return JSON.parse(localStorage.getItem("weatherLastLocation") || "null");
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

function getTodayHourlySlice(hourly, currentTime) {
  const allTimes = hourly?.time || [];
  const allTemps = hourly?.temperature_2m || [];
  const allRainChance = hourly?.precipitation_probability || [];
  const allRainAmount = hourly?.precipitation || [];

  if (!allTimes.length) {
    return { times: [], temps: [], rainChance: [], rainAmount: [] };
  }

  const targetDate = (currentTime || allTimes[0]).slice(0, 10);
  const startIndex = allTimes.findIndex((t) => t.slice(0, 10) === targetDate);

  if (startIndex === -1) {
    return { times: [], temps: [], rainChance: [], rainAmount: [] };
  }

  let endIndex = startIndex;
  while (endIndex < allTimes.length && allTimes[endIndex].slice(0, 10) === targetDate) {
    endIndex += 1;
  }

  return {
    times: allTimes.slice(startIndex, endIndex),
    temps: allTemps.slice(startIndex, endIndex),
    rainChance: allRainChance.slice(startIndex, endIndex),
    rainAmount: allRainAmount.slice(startIndex, endIndex)
  };
}

function formatHourLabel(isoDateTime, shortHourOnly = false) {
  if (typeof isoDateTime !== "string" || isoDateTime.length < 16) return "--:--";
  const hour = isoDateTime.slice(11, 13);
  const minute = isoDateTime.slice(14, 16);
  return shortHourOnly ? `${hour}:00` : `${hour}:${minute}`;
}

async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Failed request: ${url}`, error);
    return null;
  }
}

async function init() {
  unitToggle.value = unitSystem;
  renderFavorites();

  const savedLocation = loadLastViewedLocation();
  if (savedLocation && typeof savedLocation.latitude === "number" && typeof savedLocation.longitude === "number") {
    selectedLocation = savedLocation;
    await loadWeatherForSelected();
  }
}

init();
