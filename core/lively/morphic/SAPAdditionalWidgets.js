module('lively.morphic.SAPAdditionalWidgets').requires('lively.morphic.Core', 'lively.morphic.Events', 'lively.WidgetsTraits', 'lively.morphic.Styles').toRun(function() {

lively.morphic.Morph.subclass('lively.morphic.SAPFontPicker',
'default category', {
    initialize: function($super) {
        $super();
        this.setFill(Color.rgb(223, 227, 232));
        this.setBorderColor(Color.rgb(177,181,186));
        this.setExtent(lively.pt(200,500));
        this.oList;
        this.initializeUI();
    },
    initializeUI: function($super) {
        this.oList = new lively.morphic.List(new Rectangle(0, 0, 100, 100), ['1', '2', '3']);
        this.addMorph(oList);
    },
    addToGrid: function(aGrid) {
        this.grid = aGrid;
        this.grid.addMorph(this);
    },
    

});

}) // end of module