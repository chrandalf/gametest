# Character sprite sheets

Drop 288x400 PNG sheets in here and they are used instead of the painted ones,
one file per townsperson, named `0.png` .. `7.png`.

The layout is chrandalf/80sadventure's character contract, unchanged:

* cells of 48x80, six columns by five rows, anchored bottom-centre (24, 80)
* row 0 faces the camera, row 1 faces right, row 2 faces away
* columns 0-3 of those rows are the walk cycle; column 0 doubles as standing
* left-facing is row 1 mirrored, so it is never drawn
* alpha must be binary — fully opaque or fully transparent, or the edges halo

Rows 3 and 4 (expressions and idle business) are part of the contract but the
driving game does not use them, so a sheet that only fills the first three rows
works fine.

`tools/bundle.js` base64-inlines whatever is here into the single-file build, so
the distributable stays self-contained with no asset files beside it.
