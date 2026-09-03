import os
import math
import numpy as np
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy import create_engine, Column, Integer, Float, String, DateTime, Text, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sklearn.cluster import DBSCAN

# Support GeoAlchemy2 for PostGIS spatial columns
try:
    from geoalchemy2 import Geometry, Geography
    GEOALCHEMY_AVAILABLE = True
except ImportError:
    GEOALCHEMY_AVAILABLE = False

from poi_data import get_road_weight, get_proximity_weight, haversine_meters

DB_PATH = os.path.join(os.path.dirname(__file__), "vigilance.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")
IS_POSTGRES = "postgresql" in DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Detection(Base):
    __tablename__ = "detections"
    id = Column(Integer, primary_key=True, index=True)
    defect_type = Column(String, index=True)      # D00, D10, D20, D40
    confidence = Column(Float)
    severity = Column(String, index=True)         # low, medium, high, critical
    vehicle_id = Column(String, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    lat = Column(Float)
    lon = Column(Float)
    cluster_id = Column(Integer, nullable=True, index=True)
    thumbnail_b64 = Column(Text, nullable=True)
    road_name = Column(String, default="GST Road, Chennai")
    
    if GEOALCHEMY_AVAILABLE and IS_POSTGRES:
        geom = Column(Geometry(geometry_type='POINT', srid=4326), nullable=True)

class Cluster(Base):
    __tablename__ = "clusters"
    id = Column(Integer, primary_key=True, index=True)
    centroid_lat = Column(Float)
    centroid_lon = Column(Float)
    detection_count = Column(Integer, default=1)
    dominant_type = Column(String)
    max_severity = Column(String)
    rpi_score = Column(Float, default=0.0)       # 0 - 100
    status = Column(String, default="open")      # open, assigned, resolved
    road_name = Column(String, default="GST Road, Chennai")
    nearest_poi = Column(String, default="General Area")
    poi_distance_m = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    if GEOALCHEMY_AVAILABLE and IS_POSTGRES:
        geom = Column(Geometry(geometry_type='POINT', srid=4326), nullable=True)

def init_db():
    if IS_POSTGRES:
        try:
            with engine.connect() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
                conn.commit()
        except Exception as e:
            pass
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def compute_rpi(severity: str, count: int, road_type_weight: float, proximity_weight: float) -> float:
    """
    Repair Prioritization Index (RPI):
    RPI = (severity_weight * 40) + (density_weight * 25) + (traffic_importance * 20) + (proximity_score * 15)
    """
    sev_map = {"critical": 1.0, "high": 0.75, "medium": 0.50, "low": 0.25}
    s_val = sev_map.get(severity.lower(), 0.5)
    density_val = min(1.0, count / 5.0)
    
    rpi = (s_val * 40.0) + (density_val * 25.0) + (road_type_weight * 20.0) + (proximity_weight * 15.0)
    return round(min(100.0, max(10.0, rpi)), 1)

def run_spatial_deduplication(db_session) -> int:
    """
    Runs spatial deduplication (15m threshold).
    If PostgreSQL/PostGIS is active, executes native PostGIS ST_ClusterDBSCAN and ST_DWithin queries.
    If SQLite is active, executes Haversine DBSCAN with centroid matching.
    """
    detections = db_session.query(Detection).all()
    if not detections or len(detections) < 1:
        return 0

    # 1. Snapshot previous cluster statuses and centroids
    previous_clusters = db_session.query(Cluster).all()
    prev_status_map: List[Tuple[float, float, str, datetime]] = [
        (c.centroid_lat, c.centroid_lon, c.status, c.created_at) for c in previous_clusters
    ]

    # PostGIS Native Path
    if IS_POSTGRES and GEOALCHEMY_AVAILABLE:
        try:
            # Query using native PostGIS ST_ClusterDBSCAN with EPSG:3857 metric projection (15m radius)
            sql = text("""
                SELECT id,
                       ST_ClusterDBSCAN(ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 3857), eps := 15.0, minpoints := 1) OVER () as cluster_id
                FROM detections;
            """)
            result = db_session.execute(sql).fetchall()
            labels = [r[1] for r in result]
        except Exception as e:
            # Fallback if PostGIS extension query fails
            coords = np.array([[d.lat, d.lon] for d in detections])
            epsilon_rad = 15.0 / 6371000.0
            db = DBSCAN(eps=epsilon_rad, min_samples=1, metric='haversine', algorithm='ball_tree')
            labels = db.fit_predict(np.radians(coords))
    else:
        # SQLite / Standard In-Process Path
        coords = np.array([[d.lat, d.lon] for d in detections])
        coords_rad = np.radians(coords)
        epsilon_rad = 15.0 / 6371000.0
        db = DBSCAN(eps=epsilon_rad, min_samples=1, metric='haversine', algorithm='ball_tree')
        labels = db.fit_predict(coords_rad)

    # Clear existing clusters table
    db_session.query(Cluster).delete()
    
    clusters_map = {}
    for idx, cluster_label in enumerate(labels):
        det = detections[idx]
        det.cluster_id = int(cluster_label)
        
        if cluster_label not in clusters_map:
            clusters_map[cluster_label] = []
        clusters_map[cluster_label].append(det)

    created_clusters = 0
    for c_id, det_list in clusters_map.items():
        lats = [d.lat for d in det_list]
        lons = [d.lon for d in det_list]
        center_lat = float(np.mean(lats))
        center_lon = float(np.mean(lons))
        
        types = [d.defect_type for d in det_list]
        dominant_type = max(set(types), key=types.count)
        
        sev_rank = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        severities = [d.severity.lower() for d in det_list]
        max_sev = max(severities, key=lambda s: sev_rank.get(s, 1))
        
        road_name = det_list[0].road_name
        road_wt = get_road_weight(road_name)
        prox_wt, nearest_poi, poi_dist = get_proximity_weight(center_lat, center_lon)
        
        rpi = compute_rpi(max_sev, len(det_list), road_type_weight=road_wt, proximity_weight=prox_wt)
        
        # Match centroid to nearest previous cluster within 25m to preserve status
        matched_status = "open"
        created_time = datetime.utcnow()
        for prev_lat, prev_lon, prev_status, prev_created in prev_status_map:
            dist = haversine_meters(center_lat, center_lon, prev_lat, prev_lon)
            if dist <= 25.0:
                matched_status = prev_status
                created_time = prev_created
                break

        cluster = Cluster(
            id=int(c_id) + 1,
            centroid_lat=center_lat,
            centroid_lon=center_lon,
            detection_count=len(det_list),
            dominant_type=dominant_type,
            max_severity=max_sev,
            rpi_score=rpi,
            status=matched_status,
            road_name=road_name,
            nearest_poi=nearest_poi,
            poi_distance_m=poi_dist,
            created_at=created_time,
            updated_at=datetime.utcnow()
        )
        db_session.add(cluster)
        created_clusters += 1

    db_session.commit()
    return created_clusters
