export const PLAN_LIMITS={free:{folders:5,templates:5,pins:5},plus:{folders:10,templates:20,pins:10},premium:{folders:20,templates:50,pins:20},max:{folders:30,templates:100,pins:30}};
export const planLimits=id=>PLAN_LIMITS[id]||PLAN_LIMITS.free;
