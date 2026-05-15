export interface MartialArt {
  school: string
  name: string
  role: 'DPS' | 'T' | '治疗'
}

export const martialArts: MartialArt[] = [
  { school: '天策', name: '傲血战意', role: 'DPS' },
  { school: '天策', name: '铁牢律', role: 'T' },
  { school: '藏剑', name: '问水诀', role: 'DPS' },
  { school: '七秀', name: '冰心诀', role: 'DPS' },
  { school: '七秀', name: '云裳心经', role: '治疗' },
  { school: '纯阳', name: '紫霞功', role: 'DPS' },
  { school: '纯阳', name: '太虚剑意', role: 'DPS' },
  { school: '少林', name: '易筋经', role: 'DPS' },
  { school: '少林', name: '洗髓经', role: 'T' },
  { school: '万花', name: '花间游', role: 'DPS' },
  { school: '万花', name: '离经易道', role: '治疗' },
  { school: '五毒', name: '毒经', role: 'DPS' },
  { school: '五毒', name: '补天诀', role: '治疗' },
  { school: '唐门', name: '惊羽诀', role: 'DPS' },
  { school: '唐门', name: '天罗诡道', role: 'DPS' },
  { school: '明教', name: '焚影圣诀', role: 'DPS' },
  { school: '明教', name: '明尊琉璃体', role: 'T' },
  { school: '丐帮', name: '笑尘诀', role: 'DPS' },
  { school: '苍云', name: '分山劲', role: 'DPS' },
  { school: '苍云', name: '铁骨衣', role: 'T' },
  { school: '长歌', name: '莫问', role: 'DPS' },
  { school: '长歌', name: '相知', role: '治疗' },
  { school: '霸刀', name: '北傲诀', role: 'DPS' },
  { school: '蓬莱', name: '凌海诀', role: 'DPS' },
  { school: '凌雪阁', name: '隐龙诀', role: 'DPS' },
  { school: '衍天宗', name: '太玄经', role: 'DPS' },
  { school: '药宗', name: '无方', role: 'DPS' },
  { school: '药宗', name: '灵素', role: '治疗' },
  { school: '刀宗', name: '孤锋诀', role: 'DPS' },
  { school: '万灵', name: '山海心诀', role: 'DPS' },
  { school: '段氏', name: '周天功', role: 'DPS' },
  { school: '无相楼', name: '幽罗引', role: 'DPS' },
]

export function getMartialArtLabel(ma: MartialArt): string {
  return `${ma.school}·${ma.name}`
}
