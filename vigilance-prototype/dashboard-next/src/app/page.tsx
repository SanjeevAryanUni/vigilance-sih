'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ShieldAlert, Radio, RefreshCw, Wrench, PieChart as PieIcon, MapPin } from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

const WebGISMap = dynamic(() => import('@/components/WebGISMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-400 font-mono text-xs">
      Initializing Chennai WebGIS Vector Grid...
    </div>
  ),
});

// Initial High-Fidelity Chennai Municipal Transit Seed Dataset
const INITIAL_CLUSTERS = [
  { id: 1, centroid_lat: 12.9516, centroid_lon: 80.1462, detection_count: 7, dominant_type: "D40 (Pothole)", max_severity: "critical", rpi_score: 94.5, status: "open", road_name: "GST Road, Tambaram (NH-32)", nearest_poi: "MIOT Hospital Corridor", poi_distance_m: 420 },
  { id: 2, centroid_lat: 13.0067, centroid_lon: 80.2030, detection_count: 5, dominant_type: "D40 (Pothole)", max_severity: "critical", rpi_score: 89.2, status: "assigned", road_name: "Guindy Kathipara Grade Junction", nearest_poi: "Anna University", poi_distance_m: 850 },
  { id: 3, centroid_lat: 13.0604, centroid_lon: 80.2496, detection_count: 4, dominant_type: "D20 (Alligator Crack)", max_severity: "high", rpi_score: 82.1, status: "open", road_name: "Anna Salai (Mount Road)", nearest_poi: "Apollo Hospital, Greams Rd", poi_distance_m: 310 },
  { id: 4, centroid_lat: 12.8231, centroid_lon: 80.0442, detection_count: 6, dominant_type: "D40 (Pothole)", max_severity: "critical", rpi_score: 88.0, status: "open", road_name: "SRM Institute / Potheri Highway", nearest_poi: "SRM Medical College", poi_distance_m: 180 },
  { id: 5, centroid_lat: 12.9719, centroid_lon: 80.2500, detection_count: 3, dominant_type: "D10 (Transverse Crack)", max_severity: "high", rpi_score: 74.5, status: "assigned", road_name: "Old Mahabalipuram Road (OMR)", nearest_poi: "IIT Madras Zone", poi_distance_m: 1200 },
  { id: 6, centroid_lat: 13.0827, centroid_lon: 80.2707, detection_count: 4, dominant_type: "D00 (Longitudinal Crack)", max_severity: "medium", rpi_score: 68.4, status: "resolved", road_name: "Poonamallee High Road", nearest_poi: "Madras Medical College", poi_distance_m: 650 },
  { id: 7, centroid_lat: 12.9815, centroid_lon: 80.2180, detection_count: 3, dominant_type: "D40 (Pothole)", max_severity: "high", rpi_score: 79.8, status: "open", road_name: "Velachery Main Road", nearest_poi: "Fortis Malar Hospital", poi_distance_m: 1400 },
  { id: 8, centroid_lat: 13.0418, centroid_lon: 80.2341, detection_count: 5, dominant_type: "D20 (Alligator Crack)", max_severity: "high", rpi_score: 76.2, status: "open", road_name: "T. Nagar Usman Road Commercial", nearest_poi: "D.A.V. School Link", poi_distance_m: 920 },
  { id: 9, centroid_lat: 13.0878, centroid_lon: 80.2155, detection_count: 2, dominant_type: "D00 (Longitudinal Crack)", max_severity: "low", rpi_score: 52.0, status: "resolved", road_name: "Anna Nagar 2nd Avenue", nearest_poi: "Kendriya Vidyalaya", poi_distance_m: 1600 }
];

const INITIAL_DETECTIONS = [
  { id: 101, defect_type: "D40", confidence: 0.94, severity: "critical", vehicle_id: "BUS-TN01-1042", road_name: "GST Road, Tambaram (NH-32)", timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: 102, defect_type: "D20", confidence: 0.88, severity: "high", vehicle_id: "BUS-TN02-3891", road_name: "Guindy Kathipara Grade Junction", timestamp: new Date(Date.now() - 240000).toISOString() },
  { id: 103, defect_type: "D40", confidence: 0.96, severity: "critical", vehicle_id: "MUNICIPAL-TRUCK-07", road_name: "SRM Institute / Potheri Highway", timestamp: new Date(Date.now() - 360000).toISOString() },
  { id: 104, defect_type: "D10", confidence: 0.82, severity: "high", vehicle_id: "PATROL-VAN-12", road_name: "Anna Salai (Mount Road)", timestamp: new Date(Date.now() - 480000).toISOString() },
  { id: 105, defect_type: "D00", confidence: 0.79, severity: "medium", vehicle_id: "BUS-TN22-5501", road_name: "Old Mahabalipuram Road (OMR)", timestamp: new Date(Date.now() - 600000).toISOString() }
];

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:8000' : '');

const getWsUrl = (): string => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + '/ws';
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') return 'ws://localhost:8000/ws';
  return '';
};

export default function DashboardPage() {
  const [stats, setStats] = useState({
    total_detections: 64,
    deduplicated_clusters: 9,
    potholes: 24,
    cracks: 40,
    critical_severity: 14,
    high_severity: 28,
    active_vehicles: 5,
  });

  const [detections, setDetections] = useState<any[]>(INITIAL_DETECTIONS);
  const [clusters, setClusters] = useState<any[]>(INITIAL_CLUSTERS);
  const [isMounted, setIsMounted] = useState(false);

  // Tracks whether the backend API is actually reachable —
  // prevents simulation and polling from fighting each other
  const backendAlive = useRef(false);

  const fetchData = useCallback(async () => {
    if (!API_BASE) return;
    try {
      const [statsRes, detRes, clusterRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats`),
        fetch(`${API_BASE}/api/detections?limit=15`),
        fetch(`${API_BASE}/api/clusters`),
      ]);

      // If we get here without throwing, backend is alive
      backendAlive.current = true;

      if (statsRes.ok) setStats(await statsRes.json());
      if (detRes.ok) {
        const d = await detRes.json();
        if (d && d.length > 0) setDetections(d);
      }
      if (clusterRes.ok) {
        const c = await clusterRes.json();
        if (c && c.length > 0) setClusters(c);
      }
    } catch (e) {
      // Backend unreachable — let simulation handle the feed
      backendAlive.current = false;
    }
  }, []);

  const updateStatus = async (clusterId: number, newStatus: string) => {
    setClusters(prev => prev.map(c => c.id === clusterId ? { ...c, status: newStatus } : c));
    if (API_BASE) {
      try {
        await fetch(`${API_BASE}/api/clusters/${clusterId}/status?status=${newStatus}`, { method: 'POST' });
      } catch (e) {}
    }
  };

  useEffect(() => {
    setIsMounted(true);
    fetchData();

    // 1. Periodic database state sync — only overwrites state when backend
    //    is reachable (fetchData sets backendAlive internally)
    const pollInterval = setInterval(() => {
      fetchData();
    }, 8000);

    // 2. Real-time WebSocket connection to backend
    let ws: WebSocket | null = null;
    let wsConnected = false;
    const wsUrl = getWsUrl();

    if (wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          wsConnected = true;
          backendAlive.current = true;
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'NEW_DETECTION' && msg.data) {
              const d = msg.data;
              setDetections(prev => [d, ...prev.slice(0, 14)]);
              const isCrit = d.severity === 'critical';
              const isPothole = d.defect_type === 'D40' || d.defect_type === 'Pothole';
              setStats(prev => ({
                ...prev,
                total_detections: prev.total_detections + 1,
                potholes: isPothole ? prev.potholes + 1 : prev.potholes,
                cracks: !isPothole ? prev.cracks + 1 : prev.cracks,
                critical_severity: isCrit ? prev.critical_severity + 1 : prev.critical_severity,
              }));
            } else if (msg.event === 'CLUSTER_UPDATED' && msg.data) {
              setClusters(prev => prev.map(c => c.id === msg.data.id ? { ...c, ...msg.data } : c));
            }
          } catch (err) {}
        };
        ws.onclose = () => {
          wsConnected = false;
        };
        ws.onerror = () => {
          // Silently handle — backend offline is expected during demo mode
          wsConnected = false;
        };
      } catch (err) {
        wsConnected = false;
      }
    }

    // 3. Fallback Edge Perception Simulation — ONLY runs when
    //    both the WebSocket AND the REST API are unreachable
    const simInterval = setInterval(() => {
      if (wsConnected || backendAlive.current) return;

      const vehicles = ["BUS-TN01-1042", "BUS-TN02-3891", "MUNICIPAL-TRUCK-07", "PATROL-VAN-12", "BUS-TN22-5501"];
      const defects = ["D40", "D20", "D10", "D00"];
      const roads = ["GST Road, Tambaram (NH-32)", "Anna Salai (Mount Road)", "Guindy Kathipara Junction", "SRM / Potheri Corridor", "OMR IT Express Highway"];
      
      const newDefect = defects[Math.floor(Math.random() * defects.length)];
      const newRoad = roads[Math.floor(Math.random() * roads.length)];
      const newVehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
      const isCrit = newDefect === "D40" && Math.random() > 0.3;
      
      const newDet = {
        id: Date.now(),
        defect_type: newDefect,
        confidence: Number((0.82 + Math.random() * 0.16).toFixed(2)),
        severity: isCrit ? "critical" : (["D40", "D20"].includes(newDefect) ? "high" : "medium"),
        vehicle_id: newVehicle,
        road_name: newRoad,
        timestamp: new Date().toISOString()
      };

      setDetections(prev => [newDet, ...prev.slice(0, 14)]);
      setStats(prev => ({
        ...prev,
        total_detections: prev.total_detections + 1,
        potholes: newDefect === "D40" ? prev.potholes + 1 : prev.potholes,
        cracks: newDefect !== "D40" ? prev.cracks + 1 : prev.cracks,
        critical_severity: isCrit ? prev.critical_severity + 1 : prev.critical_severity,
      }));
    }, 4000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(simInterval);
      if (ws) ws.close();
    };
  }, [fetchData]);

  const chartData = {
    labels: ['Potholes (D40)', 'Cracks (D00-D20)', 'Critical Hazards'],
    datasets: [
      {
        data: [stats.potholes, stats.cracks, stats.critical_severity],
        backgroundColor: ['#DC2626', '#F59E0B', '#2563EB'],
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg text-white font-bold tracking-wider flex items-center gap-2 shadow-lg shadow-blue-600/30">
            <ShieldAlert className="w-5 h-5" />
            <span>VIGILANCE</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              Next.js 14 WebGIS Urban Road Intelligence Platform
              <span className="bg-blue-900/60 text-blue-300 text-xs px-2 py-0.5 rounded border border-blue-700 font-mono">
                SIH26124 • BEL
              </span>
            </h1>
            <p className="text-xs text-slate-400">Mobile Public Transport Passive Sensing Network • Apple M5 Edge AI Grid</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-700/60 px-3 py-1.5 rounded-full text-xs text-emerald-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{stats.active_vehicles} Fleet Nodes Active (Live Stream)</span>
          </div>
          <button
            onClick={() => fetchData()}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded border border-slate-700 flex items-center gap-1.5 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        {/* Left Column: Stats & Ingest Stream */}
        <div className="col-span-3 flex flex-col gap-4 overflow-hidden">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold">Total Ingestions</span>
              <div className="text-2xl font-bold text-slate-100 mt-1">{stats.total_detections}</div>
              <span className="text-[10px] text-blue-400">Multi-Bus Passes</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold">DBSCAN Clusters</span>
              <div className="text-2xl font-bold text-amber-400 mt-1">{clusters.length}</div>
              <span className="text-[10px] text-amber-500/80">15m Spatial Dedup</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold">Critical Potholes</span>
              <div className="text-2xl font-bold text-red-500 mt-1">{stats.critical_severity}</div>
              <span className="text-[10px] text-red-400">D40 Hazard Level</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold">Active Buses</span>
              <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.active_vehicles}</div>
              <span className="text-[10px] text-emerald-500/80">GPS Telemetry Nodes</span>
            </div>
          </div>

          {/* Live Ingestion Feed */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg flex-1 flex flex-col overflow-hidden shadow-inner">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/90">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-blue-400 animate-pulse" /> Real-Time Telemetry Stream
              </span>
              <span className="text-[10px] bg-blue-950 text-blue-300 px-1.5 py-0.5 rounded font-mono">LIVE</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {detections.map((d) => (
                <div
                  key={d.id}
                  className={`p-2.5 rounded border text-xs flex flex-col gap-1 transition-all ${
                    d.severity === 'critical' ? 'bg-red-950/30 border-red-800/60' : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className={`font-bold ${d.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                      {d.defect_type} ({d.severity?.toUpperCase()})
                    </span>
                    <span className="text-[10px] text-slate-400" suppressHydrationWarning>{isMounted ? new Date(d.timestamp).toLocaleTimeString() : '--:--:--'}</span>
                  </div>
                  <div className="text-slate-300 text-[11px] truncate">{d.road_name}</div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500 mt-0.5">
                    <span className="font-mono text-slate-400">{d.vehicle_id}</span>
                    <span className="text-blue-400 font-mono">Conf: {(d.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Column: WebGIS Vector Map */}
        <div className="col-span-6 flex flex-col gap-3 bg-slate-900 border border-slate-800 p-3 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-400" /> Chennai Arterial WebGIS Spatial Grid
            </span>
            <span className="text-[11px] text-slate-400">Datum: EPSG:4326 • 15m DBSCAN Radius</span>
          </div>

          <div className="flex-1 rounded overflow-hidden relative">
            <WebGISMap clusters={clusters} onStatusChange={updateStatus} />
          </div>

          <div className="bg-slate-950/90 border border-slate-800 p-2 rounded flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block shadow-sm shadow-red-500"></span> Critical Pothole (D40)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shadow-sm shadow-amber-500"></span> High Priority Crack (D20)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block shadow-sm shadow-blue-500"></span> Multi-Pass Cluster
              </span>
            </div>
            <span className="text-[10px] text-slate-500">Live Vector Carto Grid</span>
          </div>
        </div>

        {/* Right Column: RPI Repair Queue & Analytics */}
        <div className="col-span-3 flex flex-col gap-4 overflow-hidden">
          {/* RPI Repair Queue */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg flex-1 flex flex-col overflow-hidden shadow-inner">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/90">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-amber-400" /> RPI Priority Repair Queue
              </span>
              <span className="text-[10px] bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded font-mono">PWD Auto</span>
            </div>
            <div className="p-2 border-b border-slate-800 text-[11px] text-slate-400 bg-slate-950/40">
              Formula: <code>0.40(Sev) + 0.25(Den) + 0.20(Hwy) + 0.15(POI)</code>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {clusters.map((c, idx) => (
                <div key={c.id} className="p-2.5 bg-slate-950/80 border border-slate-800 rounded text-xs flex flex-col gap-1.5 hover:border-slate-700 transition">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded bg-blue-900 text-blue-200 text-[10px] flex items-center justify-center font-bold">
                        #{idx + 1}
                      </span>
                      <span className="font-bold text-slate-200">{c.dominant_type}</span>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono font-bold text-[11px] ${
                        c.rpi_score > 85 ? 'bg-red-900 text-red-200' : 'bg-amber-900 text-amber-200'
                      }`}
                    >
                      RPI {c.rpi_score}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 truncate">{c.road_name}</div>
                  <div className="flex justify-between items-center text-[10px] text-slate-400">
                    <span>{c.detection_count} Passes • {c.nearest_poi}</span>
                    <span
                      className={`capitalize px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        c.status === 'resolved'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : c.status === 'assigned'
                          ? 'bg-blue-950 text-blue-400 border border-blue-800'
                          : 'bg-red-950 text-red-400 border border-red-800'
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => updateStatus(c.id, 'assigned')}
                      className="flex-1 py-1 bg-slate-800 hover:bg-blue-700 text-slate-200 text-[10px] rounded transition"
                    >
                      Dispatch PWD
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'resolved')}
                      className="px-2 py-1 bg-slate-800 hover:bg-emerald-700 text-slate-200 text-[10px] rounded transition"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg h-44 flex flex-col">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1 flex items-center gap-1">
              <PieIcon className="w-3.5 h-3.5 text-blue-400" /> Defect Distribution
            </span>
            <div className="flex-1 relative">
              <Doughnut
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, color: '#94A3B8', font: { size: 9 } } },
                  },
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
