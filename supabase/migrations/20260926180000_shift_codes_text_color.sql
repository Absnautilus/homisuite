-- Lets an admin override the auto-computed (white/black) badge text color
-- per shift code instead of always deriving it from the background --
-- null keeps today's behaviour (contrast computed client-side from `color`).
alter table shift_codes
  add column text_color text
    check (text_color is null or text_color in ('#ffffff', '#111111'));
