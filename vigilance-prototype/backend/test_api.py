import os
import sys

try:
    import pytest
except ImportError:
    pytest = None

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
from main import app
from database import init_db, compute_rpi, SessionLocal, Detection, Cluster

client = TestClient(app)

if pytest:
    @pytest.fixture(scope="session", autouse=True)
    def setup_database():
        """Initialize database tables before tests run."""
        init_db()


def test_health():
    """Verify backend health check endpoint."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "VIGILANCE" in data["service"]

def test_create_and_list_detection():
    """Verify ingestion of a detection and retrieval via GET /api/detections."""
    payload = {
        "defect_type": "D40",
        "confidence": 0.94,
        "severity": "critical",
        "vehicle_id": "TEST-BUS-01",
        "lat": 12.9516,
        "lon": 80.1462,
        "road_name": "GST Road, Tambaram, Chennai"
    }
    create_res = client.post("/api/detections", json=payload)
    assert create_res.status_code == 200
    res_data = create_res.json()
    assert res_data["status"] == "success"
    assert "id" in res_data

    list_res = client.get("/api/detections?limit=10")
    assert list_res.status_code == 200
    detections = list_res.json()
    assert isinstance(detections, list)
    assert len(detections) >= 1
    matching = [d for d in detections if d["vehicle_id"] == "TEST-BUS-01"]
    assert len(matching) > 0
    assert matching[0]["defect_type"] == "D40"

def test_clusters_endpoint():
    """Verify retrieval of clustered incidents."""
    response = client.get("/api/clusters")
    assert response.status_code == 200
    clusters = response.json()
    assert isinstance(clusters, list)
    if len(clusters) > 0:
        c = clusters[0]
        assert "id" in c
        assert "centroid_lat" in c
        assert "centroid_lon" in c
        assert "rpi_score" in c
        assert "status" in c

def test_stats_endpoint():
    """Verify municipal statistical aggregation."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    stats = response.json()
    for key in [
        "total_detections",
        "deduplicated_clusters",
        "potholes",
        "cracks",
        "critical_severity",
        "high_severity",
        "active_vehicles"
    ]:
        assert key in stats

def test_heatmap_geojson():
    """Verify WebGIS Heatmap GeoJSON standard."""
    response = client.get("/api/heatmap")
    assert response.status_code == 200
    geojson = response.json()
    assert geojson["type"] == "FeatureCollection"
    assert isinstance(geojson["features"], list)
    if len(geojson["features"]) > 0:
        feat = geojson["features"][0]
        assert feat["type"] == "Feature"
        assert feat["geometry"]["type"] == "Point"
        assert len(feat["geometry"]["coordinates"]) == 2

def test_update_cluster_status():
    """Verify updating a cluster status (open -> assigned -> resolved)."""
    db = SessionLocal()
    cluster = db.query(Cluster).first()
    if not cluster:
        # Create a test cluster if none exists yet
        cluster = Cluster(
            centroid_lat=12.9516,
            centroid_lon=80.1462,
            detection_count=3,
            dominant_type="D40",
            max_severity="critical",
            rpi_score=85.0,
            status="open",
            road_name="GST Road, Tambaram, Chennai"
        )
        db.add(cluster)
        db.commit()
        db.refresh(cluster)
    
    cluster_id = cluster.id
    db.close()

    res = client.post(f"/api/clusters/{cluster_id}/status?status=assigned")
    assert res.status_code == 200
    assert res.json()["new_status"] == "assigned"

def test_compute_rpi_formula():
    """Verify the Repair Prioritization Index (RPI) calculation logic."""
    # Critical (40) + max density (25) + arterial highway (20) + POI proximity (15) = 100.0
    score_max = compute_rpi(severity="critical", count=5, road_type_weight=1.0, proximity_weight=1.0)
    assert score_max == 100.0

    # Low severity (10) + low count (5) + local road (8) + low proximity (3.75) = ~26.8
    score_low = compute_rpi(severity="low", count=1, road_type_weight=0.4, proximity_weight=0.25)
    assert 20.0 <= score_low <= 35.0

if __name__ == "__main__":
    print("==================================================")
    print("[TEST] Running VIGILANCE Backend Smoke Tests...")
    print("==================================================")
    init_db()
    tests = [
        ("Health Check", test_health),
        ("Create & List Detections", test_create_and_list_detection),
        ("Clusters Endpoint", test_clusters_endpoint),
        ("Stats Aggregation", test_stats_endpoint),
        ("Heatmap GeoJSON", test_heatmap_geojson),
        ("Update Cluster Status", test_update_cluster_status),
        ("RPI Formula Calculation", test_compute_rpi_formula),
    ]

    passed = 0
    for name, test_func in tests:
        try:
            test_func()
            print(f"  [PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {name} ({e})")

    print("==================================================")
    print(f"Results: {passed}/{len(tests)} tests passed successfully.")
    print("==================================================")
    if passed != len(tests):
        sys.exit(1)


