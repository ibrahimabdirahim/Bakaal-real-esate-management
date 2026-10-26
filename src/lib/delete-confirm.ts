// The one deletion confirmation (F57), shared by DeleteButton and the Actions menus.
export const DELETE_TITLE = "Delete record?";
export const DELETE_LABEL = "Confirm Delete";
export const deleteMessage = (what = "record") => `Are you sure you want to delete this ${what}? This action cannot be undone.`;
