"""A shared run can be unshared: its link stops working and it leaves the public gallery.

Before, the privacy notice told people to email us to unshare a run.
"""
from tests.helpers import client, make_user, push_run


def test_stop_sharing_a_run():
    alice, bob = make_user(prefix="usa"), make_user(prefix="usb")
    run_id = push_run(alice)
    token = client.post(f"/api/v1/runs/{run_id}/share", headers=alice).json()["share_token"]
    assert client.get(f"/api/v1/runs/public/{token}").status_code == 200
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).json()["is_shared"] is True

    assert client.delete(f"/api/v1/runs/{run_id}/share").status_code == 401
    assert client.delete(f"/api/v1/runs/{run_id}/share", headers=bob).status_code == 404  # not bob's run
    assert client.get(f"/api/v1/runs/public/{token}").status_code == 200

    r = client.delete(f"/api/v1/runs/{run_id}/share", headers=alice)
    assert r.status_code == 200 and r.json() == {"shared": False, "run_id": run_id}
    assert client.get(f"/api/v1/runs/public/{token}").status_code == 404
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).json()["is_shared"] is False
    gallery = client.get("/api/v1/public/gallery")
    assert gallery.status_code == 200
    assert all(i.get("share_token") != token for i in gallery.json()["items"])

    # Sharing again makes a new link; the old one stays dead.
    again = client.post(f"/api/v1/runs/{run_id}/share", headers=alice).json()["share_token"]
    assert again != token and client.get(f"/api/v1/runs/public/{token}").status_code == 404
