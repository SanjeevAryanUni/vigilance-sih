import os
import sys
import logging

sys.path.append(os.path.dirname(__file__))

from celery_app import celery_app, CELERY_AVAILABLE
from database import SessionLocal, run_spatial_deduplication

logger = logging.getLogger(__name__)

def _execute_spatial_deduplication():
    logger.info("[SPATIAL DEDUP] Executing DBSCAN spatial clustering and RPI prioritization...")
    db = SessionLocal()
    try:
        updated_clusters_count = run_spatial_deduplication(db)
        logger.info(f"[SPATIAL DEDUP] Completed spatial clustering: {updated_clusters_count} clusters updated.")
        return {"status": "SUCCESS", "clusters_updated": updated_clusters_count}
    except Exception as e:
        logger.error(f"[SPATIAL DEDUP] Deduplication failed: {e}")
        return {"status": "FAILURE", "error": str(e)}
    finally:
        db.close()

if CELERY_AVAILABLE and celery_app:
    @celery_app.task(name="tasks.async_spatial_deduplication")
    def async_spatial_deduplication():
        """
        Asynchronous Celery task for running DBSCAN spatial deduplication and RPI recalculation.
        """
        return _execute_spatial_deduplication()
else:
    class DummyCeleryTask:
        def delay(self):
            # Celery is not running/installed; raise so caller falls back to in-process execution
            raise RuntimeError("Celery worker broker is offline. Falling back to in-process execution.")
        def __call__(self):
            return _execute_spatial_deduplication()

    async_spatial_deduplication = DummyCeleryTask()

