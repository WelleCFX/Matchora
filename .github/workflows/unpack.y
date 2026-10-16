name: Unpack
on: workflow_dispatch
permissions:
  contents: write
jobs:
  unpack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Extract
        run: |
          sudo apt-get install -y p7zip-full >/dev/null
          f=$(ls *.zip *.rar 2>/dev/null | head -1)
          [ -n "$f" ] || { echo "Няма zip/rar в корена"; exit 1; }
          7z x "$f" -otmp
          d=tmp
          if [ "$(ls tmp | wc -l)" = 1 ] && [ -d "tmp/$(ls tmp)" ]; then d="tmp/$(ls tmp)"; fi
          rm "$f"
          cp -a "$d"/. .
          rm -rf tmp
      - name: Commit
        run: |
          git config user.name github-actions
          git config user.email actions@github.com
          git add -A
          git commit -m "Unpack project"
          git push
