.PHONY: build clean publish test lint

build:
	python -m build

clean:
	rm -rf dist/ build/ *.egg-info

test:
	pytest tests/ -v

lint:
	ruff check qlab/

publish-test:
	twine upload --repository testpypi dist/*

publish:
	twine upload dist/*
