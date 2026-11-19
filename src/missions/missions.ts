import type { MissionDef } from './MissionManager';
import { S } from './MissionManager';

/**
 * Story missions. (Stage 3: the framework + the first mission;
 * stages 4–5 add mini-games, dialogue and cutscenes.)
 */
export function buildMissions(): MissionDef[] {
  return [
    {
      id: 'm1', title: 'בוקר רגיל בחוף', titleEn: 'Just Another Beach Day', character: 'avi',
      start: { x: -208, z: 12 }, reward: 150, hour: 16.5,
      description: 'אמא מתקשרת: האירוע המשפחתי בירושלים ב-20:00. קודם – לאסוף את יוסי מהחוף.',
      steps: [
        S.call((c) => c.game.phone.push('msg', 'אמא ❤️', 'אבי, האירוע בירושלים ב-20:00. אל תאחר. ותביא את יוסי. ותתלבש יפה.')),
        S.goto(-262, 20, 'מצא את יוסי ליד סוכת המציל', 5),
        S.goto(-196, 42, 'חזור לרכב האדום בטיילת', 4),
        S.enterVehicle('היכנס לרכב (F)', 'sedan'),
        S.goto(-50, -30, 'סע לשוק (רחוב ליד השוק)', 8),
      ],
    },
  ];
}
