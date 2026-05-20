#!/usr/bin/env python3
import json
import sys
from pathlib import Path

OCR_CACHE = {}


def create_ocr(language):
    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        raise RuntimeError(
            "服务器还没有安装 PaddleOCR。请在项目目录执行：.venv/bin/python -m pip install paddlepaddle paddleocr"
        ) from exc

    attempts = [
        {
            "lang": language,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": language,
            "use_angle_cls": False,
            "show_log": False,
        },
        {"lang": language},
    ]

    last_error = None
    for kwargs in attempts:
        try:
            return PaddleOCR(**kwargs)
        except TypeError as exc:
            last_error = exc
    raise RuntimeError(f"PaddleOCR 初始化失败：{last_error}")


def item_text_score(item):
    if isinstance(item, dict):
        texts = item.get("rec_texts")
        scores = item.get("rec_scores") or []
        if isinstance(texts, list):
            return [(str(text), float(scores[index]) if index < len(scores) else 0.0) for index, text in enumerate(texts)]

    res = getattr(item, "res", None)
    if isinstance(res, dict):
        texts = res.get("rec_texts")
        scores = res.get("rec_scores") or []
        if isinstance(texts, list):
            return [(str(text), float(scores[index]) if index < len(scores) else 0.0) for index, text in enumerate(texts)]

    return []


def read_predict_result(ocr, image_path):
    if hasattr(ocr, "predict"):
        result = ocr.predict(input=str(image_path))
        items = []
        for item in result or []:
            items.extend(item_text_score(item))
        if items:
            return items

    result = ocr.ocr(str(image_path), cls=False)
    items = []
    for page in result or []:
        for line in page or []:
            if not isinstance(line, (list, tuple)) or len(line) < 2:
                continue
            payload = line[1]
            if isinstance(payload, (list, tuple)) and payload:
                text = str(payload[0])
                score = float(payload[1]) if len(payload) > 1 else 0.0
                items.append((text, score))
    return items


def main():
    if len(sys.argv) < 3:
        raise RuntimeError("用法：paddle_ocr.py <image_path> <language>")

    image_path = Path(sys.argv[1])
    language = sys.argv[2]
    if not image_path.exists():
        raise RuntimeError("截图文件不存在。")

    ocr = create_ocr(language)
    raw_items = read_predict_result(ocr, image_path)
    items = [
        {"text": text.strip(), "score": score}
        for text, score in raw_items
        if text and text.strip()
    ]
    print(
        json.dumps(
            {
                "engine": "paddleocr",
                "language": language,
                "text": "\n".join(item["text"] for item in items),
                "items": items,
            },
            ensure_ascii=False,
        )
    )


def recognize(image_path, language):
    path = Path(image_path)
    if not path.exists():
        raise RuntimeError("截图文件不存在。")
    if language not in OCR_CACHE:
        OCR_CACHE[language] = create_ocr(language)

    raw_items = read_predict_result(OCR_CACHE[language], path)
    items = [
        {"text": text.strip(), "score": score}
        for text, score in raw_items
        if text and text.strip()
    ]
    return {
        "engine": "paddleocr",
        "language": language,
        "text": "\n".join(item["text"] for item in items),
        "items": items,
    }


def server_loop():
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = recognize(request["imagePath"], request.get("language") or "korean")
            response = {"id": request_id, "result": result}
        except Exception as exc:
            response = {"id": request_id, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "--server":
            server_loop()
        else:
            main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
