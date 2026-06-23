-- 淵野辺テスト版コースを追加するSQLです。
-- Supabase Dashboard > SQL Editor で実行してください。
-- 同名コースが既にある場合は、そのコースのチェックポイントだけ入れ直します。

do $$
declare
  target_course_id bigint;
begin
  select id into target_course_id
  from public.orienteering_courses
  where title = '淵野辺テスト版・駅から地図を読む'
  limit 1;

  if target_course_id is null then
    insert into public.orienteering_courses(title, duration, distance, is_active)
    values ('淵野辺テスト版・駅から地図を読む', '約60分', '約2.5km', true)
    returning id into target_course_id;
  else
    update public.orienteering_courses
    set duration = '約60分',
        distance = '約2.5km',
        is_active = true,
        updated_at = now()
    where id = target_course_id;

    delete from public.orienteering_checkpoints
    where course_id = target_course_id;
  end if;

  insert into public.orienteering_checkpoints
    (course_id, name, lat, lng, points, distance, category, hint, mission, explain, sort_order)
  values
    (
      target_course_id,
      '淵野辺駅前の人の流れ',
      35.56886,
      139.39534,
      20,
      'スタート地点',
      '交通・駅前',
      '駅前広場やバス乗り場、歩道の向きに注目して、どちらへ人が流れやすいか観察します。',
      '駅前で一番「人の流れを作っている」と感じるものを1つ記録してください。',
      '駅前は鉄道、バス、徒歩、自転車の動線が重なる場所です。地図上の道路だけでなく、実際の人の動きを見ると街の中心が読みやすくなります。',
      1
    ),
    (
      target_course_id,
      '鹿沼公園の水辺と低地',
      35.56923,
      139.38978,
      30,
      '約600m',
      '公園・水',
      '公園内の池や周囲の道路との高さの違いを見てみましょう。',
      '水辺がこの場所にある理由を、地形や周辺の土地利用から仮説として書いてください。',
      '水辺や公園の位置は、昔の地形や土地利用の名残を考える手がかりになります。現地の高低差と地図を照らし合わせる題材です。',
      2
    ),
    (
      target_course_id,
      'まっすぐな道と街区の形',
      35.56689,
      139.39370,
      25,
      '約700m',
      '道路・街区',
      '駅から少し離れた住宅地で、道の直線性や街区の大きさに注目します。',
      '地図で見た道の形と、実際に歩いた印象が違った点を1つ記録してください。',
      '道路の向きや街区の形は、土地の区画整理や都市化の時期を考える入口になります。歩く速度で見ると、地図だけでは気づきにくい差が見えてきます。',
      3
    ),
    (
      target_course_id,
      '宇宙科学研究所周辺の土地利用',
      35.55876,
      139.39237,
      40,
      '約1.4km',
      '施設・土地利用',
      '大きな研究施設の周囲で、敷地の大きさ、道路、住宅地との境目を観察します。',
      '大規模施設が周辺の道や街並みに与えている影響を1つ見つけてください。',
      '大学・研究施設・工場などの大きな敷地は、周辺の道路や街区の形に影響を与えることがあります。地図上の広い区画と現地の境界を比べます。',
      4
    );
end $$;
