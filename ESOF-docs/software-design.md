# Relatório 3 - Design de Software

## Índice
1. [Introdução à Arquitetura de Software e ao Modelo de Arquitetura 4 + 1](#introducao)
1. [Vista Lógica](#logica)
1. [Vista de Desenvolvimento](#desenvolvimento)
1. [Vista de Distribuição](#deployment)
1. [Vista de Processo](#processo)

## Introdução à Arquitetura de Software e ao Modelo de Arquitetura 4 + 1

O *uBlock Origin*, através da utilização das várias tecnologias *web* usadas atualmente, implementa o Padrão Model-View-Controller.

A parte *View* do programa é implementado utilizando *HTML* e *CSS*, que permite moldar a embelezar a parte visual da extensão. Para os *Controller* e *Model* é utilizado *JavaScript* dando a possibilidade de editar as páginas dinamicamente e separando a lógica da interface.

## Vista Lógica

O *uBlock Origin* apresenta-se com os seguintes pacotes, de modo a organizar o código de maneira lógica:

![Diagrama da Vista Lógica](logical-view.png)


O programa baseia-se no *redirect engine*, que é o motor que decide que conteúdos serão ou não apresentados. Para isto, é necessário um mecanismo de filtragem de *scripts* considerados malignos ou indesejados.

Este mecanismo precisa de saber que *URLs* bloquear. Como tal, são necessárias regras que, dependendo se estão ou não na *whitelist* ou *blacklist*, permitirão ou bloquearão a transferências de conteúdo de *websites*. De modo a criar uma aplicação personalizável, além das regras estáticas, existem as regras dinâmicas, que permitem bloquear certos *downloads* indesejados, com base nas condições fornecidas pelo utilizador.

A possibilidade do utilizador inserir regras próprias cria um problema de transformar a informação introduzida em informação utilizável pelo computador. Com o intuito de resolver esse problema, o criador do projeto criou um *parser* de *URLs* que permite a criação de regras.

A interface do programa é representada pelo pacote *dashboard* que é o código que permite ao utilizador interagir com o *uBlock*. Esta extensão deve funcionar com vários navegadores de *internet* diferentes. Como tal, existe um pacote *platform* que permite o projeto correr nos vários *browser*.

## Vista de Desenvolvimento

Na vista de desenvolvimento estão representados os diversos componentes do programa e as suas relações e interdependências.
As extensões de browser têm o seu funcionamento condensado no *content script*, no caso do *uBlock Origin*, este descreve o seguinte comportamento:

![Diagrama da Vista de Desenvolvimento](development-view.png)

Ao ser executado numa página web, o programa vai dividir as suas responsabilidades por diferentes componentes que analisam e atuam sobre o *DOM* da página.
* **DOM Watcher**:
Responsável por percorrer o DOM e notificar os outros componentes se ocorrer alguma alteração, detetada através de *listeners* (verificam, por exemplo, se o número de *nodes* foi modificado).
* **DOM Surveyor**:
Procura elementos cosméticos da página, agregando uma lista de *nodes* a remover que são passados ao *DOM Filterer*.
* **DOM Filterer**:
Acede aos elementos que se deve filtrar e modifica as suas propriedades *CSS* de forma a esconder o elemento da página.
Também é usado para o processo inverso, quando se pode mostrar um elemento previamente escondido.
* **DOM Collapser**: Responsável pela filtragem dos elementos escondidos ao nível do bloqueamento dos pedidos de rede.
* **vAPI**: API usada para injeção de *HTML* nas páginas de forma a bloquear ou esconder elementos. Também é usada para comunicar entre componentes, por meio de mensagens que têm *handlers* definidos em cada componente.


## Vista de Distribuição

## Vista de Processo
