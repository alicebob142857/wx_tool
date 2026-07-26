UPDATE writing_entries
SET subtopic = CASE
  WHEN essay_title LIKE '%AI%' OR essay_title LIKE '%人工智能%' THEN '人工智能'
  WHEN essay_title LIKE '%数字%' OR theme LIKE '%数字%' THEN '数字治理'
  WHEN essay_title LIKE '%产业%' OR theme LIKE '%产业%' OR theme LIKE '%农业%' THEN '产业升级'
  ELSE '科技创新'
END
WHERE major_topic = '科技'
  AND subtopic NOT IN ('人工智能', '数字治理', '科技创新', '数据发展', '产业升级', '网络安全');

UPDATE writing_entries
SET subtopic = CASE
  WHEN essay_title LIKE '%乡%' OR theme LIKE '%乡村%' OR theme LIKE '%三农%' THEN '乡村振兴'
  WHEN essay_title LIKE '%人才%' OR theme LIKE '%就业%' OR theme LIKE '%人才%' THEN '就业人才'
  ELSE '产业发展'
END
WHERE major_topic = '经济'
  AND subtopic NOT IN ('产业发展', '营商环境', '就业人才', '乡村振兴', '区域协调', '消费发展');

UPDATE writing_entries SET subtopic = '基层治理'
WHERE major_topic = '政治'
  AND subtopic NOT IN ('理论作风', '改革创新', '干部担当', '党建引领', '基层治理', '法治建设');

UPDATE writing_entries SET subtopic = '公共服务'
WHERE major_topic = '社会'
  AND subtopic NOT IN ('社区服务', '城市治理', '公共服务', '民生保障', '教育发展', '青年成长');

UPDATE writing_entries SET subtopic = '文化自信'
WHERE major_topic = '文化'
  AND subtopic NOT IN ('文化传承', '文明建设', '文旅融合', '文化自信', '文艺传播');

UPDATE writing_entries SET subtopic = '绿色发展'
WHERE major_topic = '生态'
  AND subtopic NOT IN ('绿色发展', '环境治理', '低碳转型', '生态保护', '美丽中国');
