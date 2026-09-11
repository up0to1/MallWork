from app.presentation.server import build_app


def test_fastapi_uses_mall_work_public_title():
    assert build_app().title == "Mall Work 跨境电商 Agent"
