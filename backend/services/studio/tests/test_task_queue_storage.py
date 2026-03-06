"""Task queue storage tests for event filtering."""

from backend.services.studio.task_queue.storage import TaskStorage
from backend.services.studio.task_queue.types import CreateTaskInput


def _create_task(storage: TaskStorage, target_id: str):
    return storage.create_task(
        CreateTaskInput(
            type="image_frame",
            queue_type="image",
            target_type="shot",
            target_id=target_id,
            runtime="studio",
            payload={"prompt": f"prompt-{target_id}"},
        )
    )


def test_list_events_after_for_tasks_filters_task_ids(tmp_path):
    db_path = tmp_path / "task_queue.db"
    storage = TaskStorage(str(db_path))
    try:
        task_a = _create_task(storage, "shot_a")
        task_b = _create_task(storage, "shot_b")

        storage.insert_event(task_a.id, "processing", {"step": 1}, "ep1")
        storage.insert_event(task_b.id, "processing", {"step": 2}, "ep1")
        storage.insert_event(task_a.id, "completed", {"image_url": "a.jpg"}, "ep1")

        events = storage.list_events_after_for_tasks([task_a.id], 0)
        assert len(events) == 2
        assert all(ev.task_id == task_a.id for ev in events)
    finally:
        storage.close()


def test_list_events_after_for_tasks_respects_after_id(tmp_path):
    db_path = tmp_path / "task_queue.db"
    storage = TaskStorage(str(db_path))
    try:
        task = _create_task(storage, "shot_a")
        first = storage.insert_event(task.id, "processing", {"step": 1}, "ep1")
        second = storage.insert_event(task.id, "completed", {"image_url": "a.jpg"}, "ep1")

        events = storage.list_events_after_for_tasks([task.id], first.id)
        assert len(events) == 1
        assert events[0].id == second.id
        assert events[0].event_type == "completed"
    finally:
        storage.close()
