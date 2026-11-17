-- Riposo ("R") read as a gray fill with white text; the owner asked for
-- the opposite treatment -- white fill, dark text -- to read as "nothing
-- happening" rather than another filled work shift. text_color is
-- constrained to #ffffff/#111111 only (shift_codes_text_color_check),
-- matching the Codici turno UI's own Bianco/Nero choice.
update shift_codes set color = '#ffffff', text_color = '#111111'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code = 'R';
