-- Apply the exact colors from the reference image the hotel owner sent,
-- matched to her real shift codes (D1, D2, A1, A2, C1, C2 already exist
-- with those exact names). Leaves every rest/leave/permission code
-- untouched -- the reference shows those as plain white with colored
-- text, a bigger design change not asked for here.
update shift_codes set color = '#674ea7', text_color = '#ffffff'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('D1', 'D1 RR', 'D1 RS');

update shift_codes set color = '#a64d79', text_color = '#ffffff'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('D2', 'D2 RR', 'D2 RS');

update shift_codes set color = '#00ff00', text_color = '#111111'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('A1', 'A1 RR', 'A1 RS');

update shift_codes set color = '#ff00ff', text_color = '#111111'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('A2', 'A2 RR', 'A2 RS');

update shift_codes set color = '#ff9900', text_color = '#111111'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('C1', 'C1 RR', 'C1 RS');

update shift_codes set color = '#ffff00', text_color = '#111111'
  where property_id = 'e82a8248-2a37-45a9-abe2-686334e40f2e' and code in ('C2', 'C2 RR', 'C2 RS');
