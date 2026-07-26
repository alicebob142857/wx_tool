UPDATE writing_entries
SET
  major_topic = CASE id
    WHEN 'f749684346815950' THEN '政治'
    WHEN '86d1ad4c7f70f657' THEN '科技'
    WHEN '535d2a4d955e6c96' THEN '社会'
    WHEN '0c194cda6ff6fa78' THEN '经济'
    WHEN 'c645470b1829a152' THEN '政治'
    WHEN '53205e21e2eebbe9' THEN '文化'
    WHEN '472105f3a6d45d4b' THEN '经济'
    WHEN 'a4eb04f90224a3e1' THEN '政治'
    WHEN '4d8efa36bd2e9ef8' THEN '社会'
    WHEN '7310cced7edb26e2' THEN '政治'
    WHEN 'df8f1a21e3cfeb3a' THEN '社会'
    WHEN '4b876f2ddae23045' THEN '政治'
    WHEN '4d5c5ee12856bfa1' THEN '科技'
    WHEN 'aab8b83f0e4b98f1' THEN '政治'
    ELSE major_topic
  END,
  subtopic = CASE id
    WHEN 'f749684346815950' THEN '理论作风'
    WHEN '86d1ad4c7f70f657' THEN '人工智能'
    WHEN '535d2a4d955e6c96' THEN '社区服务'
    WHEN '0c194cda6ff6fa78' THEN '乡村振兴'
    WHEN 'c645470b1829a152' THEN '干部担当'
    WHEN '53205e21e2eebbe9' THEN '文旅融合'
    WHEN '472105f3a6d45d4b' THEN '就业人才'
    WHEN 'a4eb04f90224a3e1' THEN '党建引领'
    WHEN '4d8efa36bd2e9ef8' THEN '城市治理'
    WHEN '7310cced7edb26e2' THEN '改革创新'
    WHEN 'df8f1a21e3cfeb3a' THEN '青年成长'
    WHEN '4b876f2ddae23045' THEN '干部担当'
    WHEN '4d5c5ee12856bfa1' THEN '科技创新'
    WHEN 'aab8b83f0e4b98f1' THEN '基层治理'
    ELSE subtopic
  END
WHERE id IN (
  'f749684346815950', '86d1ad4c7f70f657', '535d2a4d955e6c96', '0c194cda6ff6fa78',
  'c645470b1829a152', '53205e21e2eebbe9', '472105f3a6d45d4b', 'a4eb04f90224a3e1',
  '4d8efa36bd2e9ef8', '7310cced7edb26e2', 'df8f1a21e3cfeb3a', '4b876f2ddae23045',
  '4d5c5ee12856bfa1', 'aab8b83f0e4b98f1'
);
