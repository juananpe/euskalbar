/*
 * Euskalbar - A Firefox extension for helping in Basque translations.
 * Copyright (C) 2006-2013 Euskalbar Taldea (see AUTHORS file)
 *
 * This file is part of Euskalbar.
 *
 * Euskalbar is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

Components.utils.import("resource://gre/modules/Services.jsm");

if (!euskalbar) var euskalbar = {};

euskalbar.app = function () {

  var $L = euskalbar.lib,
      $U = $L.utils,
      $ = $U.$;

  return {

    curVersion: "3.12",

    firstrunURL: "http://euskalbar.eu/firstrun",

    versionBaseURL: "http://euskalbar.eu/version",

    helpBaseURL: "http://euskalbar.eu/help/",

    // URI of the current user's profile directory
    profileURI: Services.dirsvc.get("ProfD", Components.interfaces.nsIFile),

    prefs: Services.prefs.getBranch("extensions.euskalbar."),

    pairs: {},

    source: null,

    target: null,


    /* Euskalbar initialization function */
    /* XXX: Try to minimize the actions executed here, as it affects to the
       overall browser startup time */
    init: function () {

      // Register to receive notifications of preference changes
      Services.prefs.addObserver("extensions.euskalbar.", this, false);

      var firstrun = euskalbar.app.prefs.getBoolPref("firstrun");
      var infoURL, openInfo = false;

      if (firstrun) {
        euskalbar.app.prefs.setBoolPref("firstrun", false);
        euskalbar.app.prefs.setCharPref("installedVersion", this.curVersion);

        /* Add Euskalbar button to the navigation bar and force
         * the toolbar to be displayed */
        euskalbar.ui.appendButtonToToolbar();
        euskalbar.ui.displayToolbar();

        euskalbar.stats.init();

        openInfo = true;
        infoURL = euskalbar.app.firstrunURL;
      } else {
        try {
          var installedVersion = euskalbar.app.prefs
                                              .getCharPref("installedVersion");

          /* We are in the middle of an upgrade */
          if (this.curVersion != installedVersion) {
            euskalbar.app.prefs.setCharPref("installedVersion",
                                            this.curVersion);

            /* Add Euskalbar button to the navigation bar and force
             * the toolbar to be displayed */
            euskalbar.ui.appendButtonToToolbar();
            euskalbar.ui.displayToolbar();

            openInfo = true;
            infoURL = euskalbar.app.versionBaseURL +
              this.curVersion.replace(/\./g, '');
          }
        } catch (ex) {
          /* Reinstall: do we need to do something in this situation? */
        }
      }

      if (openInfo) {
        setTimeout(function () {
          gBrowser.selectedTab = gBrowser.addTab(infoURL);
        }, 1000);
      }

      // Load available dictionaries
      euskalbar.dicts.available.each(function (dictName) {
        var dictURI = 'chrome://euskalbar/content/dicts/' + dictName + '.js';
        Services.scriptloader.loadSubScript(dictURI, this, 'UTF-8');

        euskalbar.app.loadPairs(dictName);
      });

      //Initialize language selection button
      var lang = this.prefs.getCharPref("language.startup");
      this.source = lang[0] + lang[1];
      this.target = lang[3] + lang[4];

      this.setLang(this.source, this.target);
      this.setDictionaries(this.source, this.target);

      euskalbar.ui.init();
    },


    // Euskalbar deskargatu
    shutdown: function () {
      window.removeEventListener("unload", euskalbar.app.shutdown, false);

      Services.prefs.removeObserver("", this);
      document.persist("euskalbar-toolbar", "currentset");
    },


    // Observerra erabili: hobespenetan aldaketa bat dagoenean exekutatzen da
    observe: function (subject, topic, data) {
      if (topic != "nsPref:changed") {
        return;
      }

      switch (data) {
        case "extensions.euskalbar.showdicts.enabled":
          this.showhideDicts();
          break;
        case "extensions.euskalbar.showcontextmenu.enabled":
          this.showContextmenu();
          break;
      }

      // Buttons' visibility
      euskalbar.dicts.available.each(function (dictName) {
        if (data === 'extensions.euskalbar.' + dictName + '.visible') {
          euskalbar.ui.toggleButtons('euskalbar-' + dictName,
                                     dictName + '.visible');
        }
      });
    },

    /*
     * Loads `dictName` into the mapping structure for language pairs.
     *
     * The underlying structure will look like this:
     *
     *   pairs: {
     *     'ab': {
     *       'cd': ['dict1', 'dict2', ..., 'dictN']
     *       'ef': ['dict1', 'dict2', ..., 'dictN']
     *     },
     *     'cd': {
     *       'ab': ['dict1', 'dict2', ..., 'dictN']
     *     }
     *   }
     */
    loadPairs: function (dictName) {
      var source, target,
          dict = euskalbar.dicts[dictName],
          ns = this.pairs;

      // If not language-pair has been specified, we'll treat it like a
      // monolingual dictionary
      if (!dict.hasOwnProperty('pairs')) {
        dict.pairs = ['eu-eu'];
      }

      dict.pairs.forEach(function (pair) {
        [source, target] = pair.split('-');

        if (!ns.hasOwnProperty(source)) {
          ns[source] = {};
        }
        if (!ns[source].hasOwnProperty(target)) {
          ns[source][target] = $L.Set();
        }
        ns[source][target].add(dictName);
      });
    },

    /*
     * Runs a query.
     *
     * The dictionary to query for and the search terms will be determined
     * according to the element that fired the event.
     */
    runQuery: function (event) {
      var dictName, isContext, term,
          source = euskalbar.app.source,
          target = euskalbar.app.target,
          element = event.target;

      dictName = element.id.split('-')[1];
      isContext = element.id.endsWith('-context');
      term = isContext ? euskalbar.ui.selectionText()
                       : $('euskalbar-search-string').value;

      if (euskalbar.app.alertEmptyBox(term)) {
        return;
      }

      // In case a context-menu search is being performed, we need to retrieve
      // the `source` and `target` languages from the element that fired this
      // event.
      if (isContext) {
        // Element IDs will have the following form:
        // `euskalbar-dictName-source_target-context`
        var pair = element.id.split('-')[2];

        // A language pair's source and target languages will always be
        // delimited by the underscore character
        if (pair && pair.indexOf('_') !== -1) {
          source = pair.slice(0,2);
          target = pair.slice(3,5);
        }
      }

      euskalbar.dicts.query(dictName, term, source, target);
    },

    /*
     * Runs a combined query.
     */
    runCombinedQueries: function (event) {
      var doc = event.target,
          url = doc.location.href,
          term = $('euskalbar-search-string').value,
          source = euskalbar.app.source,
          target = euskalbar.app.target;

      doc.removeEventListener("DOMContentLoaded",
                              euskalbar.app.runCombinedQueries, true);

      if (url.indexOf("chrome://euskalbar/content/html/") != -1) {
        // FIXME: This code is repeated, find a way to pass it along while
        // being able to remove the event listener.
        var lang = "";
        if ((source == 'es') || (target == 'es')) {
          lang = "es";
        } else if ((source == 'fr') || (target == 'fr')) {
          lang = "fr";
        } else {
          lang = "en";
        }

        var key = "";
        if (url.indexOf("euskalbarshift") != -1) {
          key = "onkey1";
        } else if (url.indexOf("euskalbarktrl") != -1) {
          key = "onkey2";
        }

        euskalbar.app.initHTML(doc, key, lang);

        // Go through each dictionary
        euskalbar.dicts.available.each(function (dictName) {
          try {
            var prefName = dictName + '.' + key + '.' + lang;
            if (euskalbar.app.prefs.getBoolPref(prefName)) {
              euskalbar.dicts.combinedQuery(dictName, term, source, target,
                                            doc);
            }
          } catch (e) {
            $U.log("Error while running combined query for " + dictName);
          }
        });
      }
    },

    // Initializes the HTML files in preparation of the combined queries
    initHTML: function (doc, key, lang) {
      // Sets the theme for the HTML files
      var prefStyle = euskalbar.app.prefs.getCharPref("style.combinedquery"),
          link = doc.getElementsByTagName("link")[0];
      link.setAttribute("href", prefStyle);

      var childPrefs = euskalbar.app.prefs.getChildList("", {}),
          isEnabledPref = function (value, index, array) {
            return (value.indexOf(key + '.' + lang) !== -1 &&
                    euskalbar.app.prefs.getBoolPref(value));
          },
          enabledPrefs = childPrefs.filter(isEnabledPref);

      enabledPrefs.forEach(function (prefName) {
        var dictName = prefName.split(".")[0],
            dictDisplayName = euskalbar.dicts[dictName].displayName;

        $('buruak', doc).innerHTML = $('buruak', doc).innerHTML
                                     + '<th id="dictName' + dictName + '">'
                                     + dictDisplayName + '<\/th>';

        var atd = doc.createElement('td');
        atd.setAttribute("id", "a" + dictName);
        atd.setAttribute("class", "gorputza");
        doc.getElementById('gorputzak').appendChild(atd);

        var ato = doc.createElement('td');
        ato.setAttribute("id", "o" + dictName);
        ato.setAttribute("class", "gorputza");
        doc.getElementById('oinak').appendChild(ato);
      });

      doc.getElementById('oharra').innerHTML = $U._("oharra");
    },


    // Shows help
    openHelp: function () {
      var locale = $U.langCode(euskalbar.ui.locale);

      if (euskalbar.ui.acceptedLocales.indexOf(locale) == -1) {
        var locale = 'en';
      }

      this.reuseOldTab(this.helpBaseURL + locale, "euskalbarhelp");
    },

    // Shows/hides dictionaries menu
    showhideDicts: function () {
      var menuEntry = $('euskalbar-menu');
      var appmenuEntry = $("appmenu_euskalbar");
      var appmenuSpacer = $("euskalbar-appmenu-spacer");

      if (!this.prefs.getBoolPref("showdicts.enabled")) {
        menuEntry.setAttribute('hidden', true);
        appmenuEntry.setAttribute('hidden', true);
        appmenuSpacer.setAttribute('hidden', true);
      } else {
        menuEntry.removeAttribute('hidden');
        appmenuEntry.removeAttribute('hidden');
        appmenuSpacer.removeAttribute('hidden');
      }
    },


    // Shows/hides context menu
    showContextmenu: function () {
      var sep = $('euskalbar-context-menuseparator');
      var button = $('euskalbar-context-menu');
      if (!this.prefs.getBoolPref("showcontextmenu.enabled")) {
        sep.setAttribute('hidden', true);
        button.setAttribute('hidden', true);
      } else {
        sep.removeAttribute('hidden');
        button.removeAttribute('hidden');
      }
    },


    // Shows prefs window
    euskalbarOptions: function () {
      var dialogURL = "chrome://euskalbar/content/prefs.xul";
      var prefwindow = window.openDialog(dialogURL, "", "chrome,modal,close");
    },


    // Estatistika lokalak erakusten ditu
    showLocalstats: function () {
      var t = gBrowser.addTab("chrome://euskalbar/content/stats.xul");
      gBrowser.selectedTab = t;
    },


    /* Toggles Euskalbar status */
    toggleBar: function (event) {
      if (event.target.id != "cmd_toggleEuskalbar") {
        return;
      }

      var el = $("euskalbar-toolbar");
      var state = el.collapsed;
      el.collapsed = !state;
    },

    // Laster-teklen aginduak exekutatzen ditu
    teklakEuskalbar: function (prefer) {
      switch (prefer) {
      case "showdicts":
        this.prefs.setBoolPref(prefer + ".enabled",
                               !this.prefs.getBoolPref(prefer + ".enabled"));
        break;
      case "showcontextmenu":
        this.prefs.setBoolPref(prefer + ".enabled",
                               !this.prefs.getBoolPref(prefer + ".enabled"));
        break;
      case "focustextbox":
        var tb = $("euskalbar-search-string");
        tb.focus();
        tb.select();
        break;
      case "toggledicts":
        this.toggleLang();
        break;
      }
    },


    // *************************************
    //  Euskalbarren barneko funtzioak
    // *************************************

    /**
     * Opens a browser tab with the given URL.
     * @param url
     *        The URL to open.
     * @param slug
     *        A unique string to identify the dictionary.
     * @param method
     *        The method of the HTTP request.
     * @param params
     *        Data to be sent in the HTTP request.
     *
     *        Parameters can either be:
     *        #. An object of key-value pairs. In case values are functions,
     *        the returned value will be used.
     *        #. Arrays serialized out of forms. In these situations the object
     *        elements of the array must have 'name' and 'value' properties.
     *
     *        Values will be properly escaped when invoking this function, so
     *        no prior escaping is needed.
     */
    openURL: function (url, slug, method, params) {
      var postData = null,
          dataString = $U.serialize(params);

      if (method == 'GET') {
        if (url.indexOf("?") == -1 && dataString) {
          url += "?";
        }

        url += dataString;
      } else if (method == "POST") {
        var stringStream = Cc["@mozilla.org/io/string-input-stream;1"]
                           .createInstance(Components.interfaces.nsIStringInputStream);

        stringStream.data = dataString;

        var postData = Cc["@mozilla.org/network/mime-input-stream;1"]
                       .createInstance(Components.interfaces.nsIMIMEInputStream);
        postData.addHeader("Content-Type", "application/x-www-form-urlencoded");
        postData.addContentLength = true;
        postData.setData(stringStream);
      }

      if (this.prefs.getBoolPref("reusetabs.enabled")) {
        this.reuseOldTab(url, slug, postData);
      } else {
        this.openNewTab(url, slug, postData);
      }

      if (!this.prefs.getBoolPref("focuswindow.enabled")) {
        var tb = $("euskalbar-search-string");
        tb.focus();
        tb.select();
      }
    },


    /* Open URL in a new tab */
    openNewTab: function (tabUrl, slug, aPostData) {
      var newTab = gBrowser.addTab(tabUrl, null, null, aPostData);

      // Store slug as an attribute for reusing purposes
      newTab.setAttribute('slug', slug);

      if (!this.prefs.getBoolPref("bgtabs.enabled")) {
        gBrowser.selectedTab = newTab;
      }
    },


    /* Reuse old tab by querying tabs for the 'slug' attribute */
    reuseOldTab: function (tabUrl, slug, aPostData) {
      var numTabs = gBrowser.tabs.length;
      var found = false;
      var index = 0;

      while (index < numTabs && !found) {
        var currentTab = gBrowser.tabs[index];

        if (currentTab.hasAttribute('slug')
            && currentTab.getAttribute('slug') == slug) {

          var currentBrowser = gBrowser.getBrowserAtIndex(index);
          currentBrowser.webNavigation.loadURI(tabUrl, null, null,
                                               aPostData, null);

          if (!this.prefs.getBoolPref("bgtabs.enabled")) {
            gBrowser.tabContainer.selectedIndex = index;
          }
          currentBrowser.focus();
          found = true;
        }

        index++;
      }

      if (!found) {
        this.openNewTab(tabUrl, slug, aPostData);
      }
    },

    /* Returns the tab index by matching a given slug */
    getTabIndexBySlug: function (slug) {
      var found = false,
          index = 0,
          numTabs = gBrowser.tabs.length;

      while (index < numTabs && !found) {
        var currentTab = gBrowser.tabs[index];

        if (currentTab.hasAttribute('slug')
            && currentTab.getAttribute('slug') == slug) {
          found = true;
        }
        index++;
      }

      if (found) {
        return index - 1;
      }

      return -1;
    },


    // Kutxa hutsik badago, mezu bat bidali
    alertEmptyBox: function (katea) {
      // Remove pre and post whitespaces
      katea = katea.replace(/^\s+|\s+$/g, "");
      if (katea === "") {
        var euskalbarNotify = gBrowser.getNotificationBox();
        euskalbarNotify.appendNotification($U._f("kutxahutsa", ""));

        var t = setTimeout(function(){
          euskalbarNotify.removeCurrentNotification();
        }, 4000);

        return true;
      }

      return false;
    },


    // Enter tekla sakatzean irekitzen diren hiztegiak
    goEuskalBarOnKey: function (event) {
      var term = $('euskalbar-search-string').value;

      // If user pressed Enter key
      if (event.keyCode == 13) {
        if (this.alertEmptyBox(term)) {
          return;
        }

        if ((event.shiftKey) || (event.ctrlKey)) {
          var k, url, slug;

          if (event.shiftKey) {
            k = "onkey1";
            url = 'chrome://euskalbar/content/html/euskalbarshift.html';
            slug = 'euskalbarshift';
          } else if (event.ctrlKey) {
            k = "onkey2";
            url = 'chrome://euskalbar/content/html/euskalbarktrl.html';
            slug = 'euskalbarktrl';
          }

          this.openURL(url, slug, null, null);

          var tab = gBrowser
            .getBrowserAtIndex(euskalbar.app.getTabIndexBySlug(slug));
          tab.addEventListener("DOMContentLoaded", this.runCombinedQueries,
                               true);
        } else {
          // User pressed the ENTER Key

          // Language-dependant dictionaries
          for (var source in this.pairs) {
            if (this.source === source &&
                this.pairs[source].hasOwnProperty(this.target)) {
              var targetDicts = this.pairs[source][this.target];

              targetDicts.each(function (dictName) {
                if (euskalbar.app.prefs.getBoolPref(dictName + '.onkey')) {
                  euskalbar.dicts.query(dictName, term,
                                        euskalbar.app.source,
                                        euskalbar.app.target);
                }
              });
            }
          }

          // Language-independent dictionaries
          this.pairs.eu.eu.each(function (dictName) {
            if (euskalbar.app.prefs.getBoolPref(dictName + '.onkey')) {
              euskalbar.dicts.query(dictName, term,
                                    euskalbar.app.source,
                                    euskalbar.app.target);
            }
          });
        }
      }
    },


    // Toggles the active language pair
    toggleLang: function () {
      this.setLang(this.target, this.source);
    },


    // Sets the new active language pair
    setLang: function (source, target) {
      // Don't set unsupported language pairs
      if (!(this.pairs.hasOwnProperty(source) ||
            this.pairs[source].hasOwnProperty(target))) {
        return;
      }

      $("euskalbar-language").setAttribute("label",
                                           source.toUpperCase() +
                                           " ‣ " +
                                           target.toUpperCase());
      this.source = source;
      this.target = target;
    },


    // Adapts dictionary visibility according to the given language pair
    setDictionaries: function (source, target) {
      var showDicts = this.pairs[source][target],
          euDicts = this.pairs.eu.eu,
          hideDicts = euskalbar.dicts.available.difference(showDicts)
                                               .difference(euDicts);

      hideDicts.each(function (dictName) {
        $('euskalbar-' + dictName).setAttribute('hidden', true);
      });
      showDicts.each(function (dictName) {
        $('euskalbar-' + dictName).setAttribute('hidden', false);
      });
    },

  };

}();

window.addEventListener("load", function(e) {
    window.removeEventListener('load', euskalbar.app.init, false);
    euskalbar.app.init();
}, false);
window.addEventListener("unload", function(e) {
  euskalbar.app.shutdown();
}, false);
