-- Google's Place Photos terms require showing authorAttributions wherever
-- the photo appears, so the attribution travels alongside the URL rather
-- than being derivable from it later.
alter table restaurants
  add column cover_image_url text,
  add column cover_image_attribution text;
