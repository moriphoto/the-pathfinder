(function () {
  var centre = [50.118, -5.620];
  var map = window.pathfinderMap;
  if (!map) {
    map = L.map('map', { zoomControl: true }).setView(centre, 12);
    window.pathfinderMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
  }
  function fixMapSize() {
    setTimeout(function () { map.invalidateSize(); }, 200);
  }
  window.addEventListener('resize', fixMapSize);
  window.addEventListener('orientationchange', fixMapSize);
  fixMapSize();

  var osm = null;
  map.eachLayer(function (layer) {
    if (layer instanceof L.TileLayer) osm = layer;
  });
  var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri'
  });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '&copy; OpenTopoMap'
  });
  var layers = {};
  if (osm) layers.OpenStreetMap = osm;
  else {
    osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    layers.OpenStreetMap = osm;
  }
  layers.Satellite = satellite;
  layers.Topographic = topo;
  L.control.layers(layers, null, { collapsed: false }).addTo(map);
  L.control.scale({ imperial: true, metric: true }).addTo(map);

  var waypoints = [];
  var routeLine = null;
  var lastRouteMode = null;
  var geoWatch = null;
  var geoMarker = null;
  var geoCircle = null;
  var lastGps = null;
  var listEl = document.getElementById('waypoint-list');
  var statusEl = document.getElementById('status');
  var statsEl = document.getElementById('route-stats');
  var gpsStatsEl = document.getElementById('gps-stats');
  var walkBtn = document.getElementById('btn-walk');
  var gpsBtn = document.getElementById('btn-gps');

  function letter(i) { return String.fromCharCode(65 + (i % 26)); }
  function fmt(latlng) { return latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5); }
  function formatDistance(metres) {
    return (metres / 1000).toFixed(2) + ' km  ·  ' + (metres / 1609.344).toFixed(2) + ' miles';
  }
  function formatDuration(seconds) {
    var mins = Math.round(seconds / 60);
    if (mins < 60) return mins + ' minutes (typical walking pace)';
    return Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min (typical walking pace)';
  }
  function routeOpacity() {
    var el = document.getElementById('route-opacity');
    return ((el && parseInt(el.value, 10)) || 65) / 100;
  }
  function routeStyle() {
    return { color: '#c43c7a', weight: 6, opacity: routeOpacity(), lineJoin: 'round', lineCap: 'round' };
  }
  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    waypoints.forEach(function (wp, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span><strong>' + letter(i) + '</strong> <span class="coords">' + fmt(wp.getLatLng()) + '</span></span>';
      listEl.appendChild(li);
    });
  }
  function refreshIcons() {
    waypoints.forEach(function (marker, i) {
      marker.setIcon(L.divIcon({
        className: '',
        html: '<div class="wp-label">' + letter(i) + '</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }));
    });
  }
  function addWaypoint(latlng) {
    var marker = L.marker(latlng, { draggable: true }).addTo(map);
    marker.on('dragend', function () {
      renderList();
      if (lastRouteMode === 'walk' && waypoints.length >= 2) plotWalkingRoute();
      else if (lastRouteMode === 'straight') drawStraight();
    });
    waypoints.push(marker);
    refreshIcons();
    renderList();
  }
  function clearRoute() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (statsEl) { statsEl.style.display = 'none'; statsEl.innerHTML = ''; }
  }
  function showStats(metres, seconds) {
    if (!statsEl) return;
    statsEl.style.display = 'block';
    statsEl.innerHTML = '<strong>' + formatDistance(metres) + '</strong><span>' + formatDuration(seconds) + '</span>';
  }
  function drawStraight() {
    clearRoute();
    lastRouteMode = 'straight';
    if (waypoints.length < 2) { if (statusEl) statusEl.textContent = 'Place at least two waypoints.'; return; }
    routeLine = L.polyline(waypoints.map(function (m) { return m.getLatLng(); }), Object.assign(routeStyle(), { dashArray: '8 6', weight: 4 })).addTo(map);
    if (statusEl) statusEl.textContent = 'Straight-line connection (not a walking route).';
  }
  function plotWalkingRoute() {
    if (waypoints.length < 2) { if (statusEl) statusEl.textContent = 'Place at least two waypoints.'; return; }
    var coords = waypoints.map(function (m) {
      var ll = m.getLatLng();
      return ll.lng.toFixed(6) + ',' + ll.lat.toFixed(6);
    }).join(';');
    var url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + coords + '?overview=full&geometries=geojson&steps=false';
    if (walkBtn) walkBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Plotting a walk…';
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route');
      var route = data.routes[0];
      clearRoute();
      lastRouteMode = 'walk';
      var latlngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      routeLine = L.polyline(latlngs, routeStyle()).addTo(map);
      showStats(route.distance, route.duration);
      try { map.fitBounds(routeLine.getBounds(), { padding: [40, 40], maxZoom: 16 }); } catch (e) {}
      if (statusEl) statusEl.textContent = 'Walk plotted.';
    }).catch(function () {
      if (statusEl) statusEl.textContent = 'Could not calculate a walking route. Move points closer to paths or roads.';
    }).finally(function () { if (walkBtn) walkBtn.disabled = false; });
  }
  function startGps() {
    if (!navigator.geolocation) { if (statusEl) statusEl.textContent = 'No location services.'; return; }
    if (gpsBtn) { gpsBtn.textContent = 'Hide my location'; gpsBtn.classList.add('active-gps'); }
    geoWatch = navigator.geolocation.watchPosition(function (pos) {
      var latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      lastGps = { latlng: latlng, accuracy: pos.coords.accuracy };
      if (!geoMarker) {
        geoMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
      } else geoMarker.setLatLng(latlng);
      if (!geoCircle) {
        geoCircle = L.circle(latlng, { radius: pos.coords.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.12 }).addTo(map);
      } else geoCircle.setLatLng(latlng).setRadius(pos.coords.accuracy);
      if (gpsStatsEl) {
        gpsStatsEl.style.display = 'block';
        gpsStatsEl.innerHTML = '<strong>' + fmt(latlng) + '</strong><span>Accuracy about ' + Math.round(pos.coords.accuracy) + ' m</span>';
      }
      if (statusEl) statusEl.textContent = 'Location active.';
      var hud = document.getElementById('hud-info');
      if (hud) hud.textContent = fmt(latlng) + ' · ±' + Math.round(pos.coords.accuracy) + ' m';
      if (document.body.classList.contains('fullscreen')) map.setView(latlng, Math.max(map.getZoom(), 16), { animate: false });
    }, function (err) {
      if (statusEl) statusEl.textContent = err.code === 1 ? 'Location permission denied. Use HTTPS and allow location.' : 'Location unavailable.';
    }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
  }
  function stopGps() {
    if (geoWatch !== null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    if (gpsBtn) { gpsBtn.textContent = 'Show my location'; gpsBtn.classList.remove('active-gps'); }
  }

  map.on('click', function (e) { addWaypoint(e.latlng); });
  if (walkBtn) walkBtn.addEventListener('click', plotWalkingRoute);
  var routeBtn = document.getElementById('btn-route');
  if (routeBtn) routeBtn.addEventListener('click', drawStraight);
  var clearBtn = document.getElementById('btn-clear');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    waypoints.forEach(function (m) { map.removeLayer(m); });
    waypoints.length = 0;
    lastRouteMode = null;
    clearRoute();
    renderList();
  });
  var undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.addEventListener('click', function () {
    var last = waypoints.pop();
    if (last) map.removeLayer(last);
    refreshIcons();
    renderList();
    if (waypoints.length < 2) { lastRouteMode = null; clearRoute(); }
    else if (lastRouteMode === 'walk') plotWalkingRoute();
    else if (lastRouteMode === 'straight') drawStraight();
  });
  if (gpsBtn) gpsBtn.addEventListener('click', function () {
    if (geoWatch !== null) {
      stopGps();
      if (geoMarker) { map.removeLayer(geoMarker); geoMarker = null; }
      if (geoCircle) { map.removeLayer(geoCircle); geoCircle = null; }
      if (statusEl) statusEl.textContent = 'Location hidden.';
    } else startGps();
  });
  var centreBtn = document.getElementById('btn-gps-centre');
  if (centreBtn) centreBtn.addEventListener('click', function () {
    if (lastGps) map.setView(lastGps.latlng, Math.max(map.getZoom(), 15));
    else if (geoWatch === null) startGps();
  });
  var fsBtn = document.getElementById('btn-fullscreen');
  if (fsBtn) fsBtn.addEventListener('click', function () {
    document.body.classList.add('fullscreen');
    if (geoWatch === null) startGps();
    if (lastGps) map.setView(lastGps.latlng, Math.max(map.getZoom(), 16));
    fixMapSize();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  });
  var exitBtn = document.getElementById('btn-exit-fs');
  if (exitBtn) exitBtn.addEventListener('click', function () {
    document.body.classList.remove('fullscreen');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    fixMapSize();
  });
  var autoBtn = document.getElementById('btn-auto');
  if (autoBtn) autoBtn.addEventListener('click', plotWalkingRoute);
  var jumpBtn = document.getElementById('btn-map-jump');
  if (jumpBtn) jumpBtn.addEventListener('click', function () {
    document.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth' });
    fixMapSize();
  });
  var op = document.getElementById('route-opacity');
  if (op) op.addEventListener('input', function () {
    var lab = document.getElementById('opacity-label');
    if (lab) lab.textContent = this.value + '%';
    if (routeLine) routeLine.setStyle({ opacity: routeOpacity() });
  });
  if (statusEl) statusEl.textContent = 'Map ready. Tap to place A, B, C then Plot route.';
})();
