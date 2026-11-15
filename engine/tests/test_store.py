from sentinel.store import Store


def event(id: str, session: str) -> dict:
    return {"id": id, "session_id": session, "created_at": 1.0, "updated_at": 1.0, "stage": "returned",
            "headline": "ALLOW", "upstream": None}


def test_events_filter_by_session(tmp_path):
    store = Store(tmp_path / "s.db")
    for id, session in [("a1", "a"), ("b1", "b"), ("a2", "a")]:
        store.upsert_event(event(id, session))
    assert [e["id"] for e in store.events(session="a")] == ["a2", "a1"]
    assert len(store.events()) == 3
