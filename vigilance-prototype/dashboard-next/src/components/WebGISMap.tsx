'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface ClusterData {
  id: number;
  centroid_lat: number;
  centroid_lon: number;
  detection_count: number;
  dominant_type: string;
  max_severity: string;
  rpi_score: number;
  status: string;
  road_name: string;
  nearest_poi?: string;
  poi_distance_m?: number;
}

interface WebGISMapProps {
  clusters: ClusterData[];
  onStatusChange: (clusterId: number, newStatus: string) => void;
}

// All styles use proven raster tile services — zero API keys needed
const MAP_STYLES: Record<string, { label: string; style: maplibregl.StyleSpecification }> = {
  osmStandard: {
    label: '🗺️ Street Map',
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-tiles-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
  esriSatellite: {
    label: '🛰️ Satellite',
    style: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 20 },
      ],
    },
  },
  esriTopo: {
    label: '🏔️ Topography',
    style: {
      version: 8,
      sources: {
        'esri-topo': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri, HERE, Garmin, OpenStreetMap',
        },
      },
      layers: [
        { id: 'esri-topo-layer', type: 'raster', source: 'esri-topo', minzoom: 0, maxzoom: 20 },
      ],
    },
  },
  humanitarian: {
    label: '🏥 Humanitarian',
    style: {
      version: 8,
      sources: {
        'hot-tiles': {
          type: 'raster',
          tiles: ['https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors, Humanitarian OSM Team',
        },
      },
      layers: [
        { id: 'hot-tiles-layer', type: 'raster', source: 'hot-tiles', minzoom: 0, maxzoom: 19 },
      ],
    },
  },
};

const DEFAULT_STYLE = 'osmStandard';

export default function WebGISMap({ clusters, onStatusChange }: WebGISMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const clustersRef = useRef<ClusterData[]>(clusters);
  const [currentStyle, setCurrentStyle] = useState<string>(DEFAULT_STYLE);

  // Keep the ref in sync with the latest clusters prop
  useEffect(() => {
    clustersRef.current = clusters;
  }, [clusters]);

  // Helper: add cluster markers to the map
  const addMarkers = (map: maplibregl.Map, clusterData: ClusterData[]) => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    clusterData.forEach((c) => {
      const isCrit = c.max_severity?.toLowerCase() === 'critical';
      const el = document.createElement('div');
      el.className = 'custom-cluster-node cursor-pointer';

      const bgColor = isCrit ? '#DC2626' : c.rpi_score > 75 ? '#EA580C' : '#2563EB';
      const borderColor = isCrit ? '#FCA5A5' : '#93C5FD';

      el.innerHTML = `
        <div style="
          background: ${bgColor};
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid ${borderColor};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          box-shadow: 0 0 14px ${bgColor};
          transition: transform 0.2s ease-in-out;
          cursor: pointer;
        ">
          ${c.detection_count}
        </div>
      `;

      const popupContent = `
        <div style="color: #0f172a; padding: 6px; font-family: sans-serif; min-width: 180px;">
          <h4 style="font-weight: 700; font-size: 13px; margin: 0 0 4px 0; color: #1e293b;">
            ${c.dominant_type} (RPI: ${c.rpi_score})
          </h4>
          <p style="font-size: 11px; color: #475569; margin: 0 0 4px 0;">${c.road_name}</p>
          <div style="font-size: 10px; color: #64748b; margin-bottom: 6px; line-height: 1.4;">
            <span>📍 POI: <b>${c.nearest_poi || 'Urban Corridor'}</b></span><br/>
            <span>🚗 Multi-Passes: <b>${c.detection_count}</b></span><br/>
            <span>⚡ Status: <b style="text-transform: uppercase; color: #2563eb;">${c.status}</b></span>
          </div>
        </div>
      `;

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(popupContent);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([c.centroid_lon, c.centroid_lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });
  };

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[DEFAULT_STYLE].style,
      center: [80.2030, 13.0067], // Chennai Center (Guindy / Kathipara)
      zoom: 11.5,
      pitch: 30,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.resize();
    });

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    if (mapContainer.current) {
      resizeObserver.observe(mapContainer.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
    };
  }, []);

  const handleStyleChange = (styleKey: string) => {
    setCurrentStyle(styleKey);
    const map = mapRef.current;
    if (map && MAP_STYLES[styleKey]) {
      map.setStyle(MAP_STYLES[styleKey].style);
      // Re-add markers after style finishes loading — use ref for latest data
      map.once('style.load', () => {
        addMarkers(map, clustersRef.current);
      });
    }
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Wait until map is fully loaded before adding markers
    if (map.loaded()) {
      addMarkers(map, clusters);
    } else {
      map.once('load', () => addMarkers(map, clusters));
    }
  }, [clusters]);

  return (
    <div className="w-full h-full min-h-[450px] relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
      <div ref={mapContainer} className="w-full h-full absolute inset-0" />

      {/* Map Style Switcher Bar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 bg-slate-900/90 border border-slate-700/80 backdrop-blur p-1.5 rounded-lg shadow-xl">
        {Object.entries(MAP_STYLES).map(([key, item]) => (
          <button
            key={key}
            onClick={() => handleStyleChange(key)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-all ${
              currentStyle === key
                ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
